import { randomUUID } from 'node:crypto';
import type {
  Card,
  GenerationCandidate,
  GenerationJob,
  GenerationRequest,
  GenerationAcceptResponse,
} from '@recollect/contracts';
import { initialSchedule } from '@recollect/scheduler';
import {
  appendChanges,
  DomainError,
  hash,
  lockOwner,
  transaction,
  type Database,
} from '@recollect/db';
import { getDeck, insertCard } from './sync.js';

export interface JobRow {
  id: string;
  owner_id: string;
  deck_id: string;
  operation_id: string;
  payload_hash: string;
  prompt: string;
  card_count: number;
  status: GenerationJob['status'];
  candidates: GenerationCandidate[];
  accepted_candidate_ids: string[];
  error: { code: string; message: string } | null;
  created_at: Date;
  updated_at: Date;
}
export function jobResponse(row: JobRow): GenerationJob {
  return {
    id: row.id,
    deckId: row.deck_id,
    status: row.status,
    prompt: row.prompt,
    count: row.card_count,
    candidates: row.candidates,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    acceptedCandidateIds: row.accepted_candidate_ids,
  };
}
export class GenerationService {
  constructor(
    readonly db: Database,
    readonly dailyCards: number,
  ) {}
  async create(owner: string, body: GenerationRequest): Promise<GenerationJob> {
    return transaction(this.db, async (tx) => {
      await lockOwner(tx, owner);
      const prior = (
        await tx.query<JobRow>(
          'SELECT * FROM recollect.generation_jobs WHERE owner_id=$1 AND operation_id=$2',
          [owner, body.operationId],
        )
      ).rows[0];
      if (prior) {
        if (prior.payload_hash !== hash(body))
          throw new DomainError(
            'operation_id_reused',
            'Generation ID was reused with changed input.',
            409,
          );
        return jobResponse(prior);
      }
      const deck = await getDeck(tx, owner, body.deckId);
      if (!deck || deck.deletedAt)
        throw new DomainError('not_found', 'An active owned deck is required.', 404);
      const quota = (
        await tx.query<{ reserved: number }>(
          'INSERT INTO recollect.quota_buckets(owner_id,quota_date,reserved) VALUES($1,$2,$3) ON CONFLICT(owner_id,quota_date) DO UPDATE SET reserved=recollect.quota_buckets.reserved+excluded.reserved RETURNING reserved',
          [owner, new Date().toISOString().slice(0, 10), body.count],
        )
      ).rows[0]!;
      if (quota.reserved > this.dailyCards)
        throw new DomainError('quota_exhausted', 'Daily generation quota exhausted.', 429);
      const row = (
        await tx.query<JobRow>(
          "INSERT INTO recollect.generation_jobs(id,owner_id,deck_id,operation_id,payload_hash,prompt,card_count,status) VALUES($1,$2,$3,$4,$5,$6,$7,'queued') RETURNING *",
          [randomUUID(), owner, body.deckId, body.operationId, hash(body), body.prompt, body.count],
        )
      ).rows[0]!;
      return jobResponse(row);
    });
  }
  async get(owner: string, id: string): Promise<GenerationJob> {
    const row = (
      await this.db.query<JobRow>(
        'SELECT * FROM recollect.generation_jobs WHERE owner_id=$1 AND id=$2',
        [owner, id],
      )
    ).rows[0];
    if (!row) throw new DomainError('not_found', 'Generation not found.', 404);
    return jobResponse(row);
  }
  async cancel(owner: string, id: string): Promise<GenerationJob> {
    const row = (
      await this.db.query<JobRow>(
        "UPDATE recollect.generation_jobs SET status='canceled',fence=NULL,lease_until=NULL,updated_at=now() WHERE owner_id=$1 AND id=$2 AND status IN ('queued','running') RETURNING *",
        [owner, id],
      )
    ).rows[0];
    return row ? jobResponse(row) : this.get(owner, id);
  }
  async accept(
    owner: string,
    id: string,
    body: { operationId: string; candidateIds: string[] },
  ): Promise<GenerationAcceptResponse> {
    return transaction(this.db, async (tx) => {
      const head = await lockOwner(tx, owner);
      const fingerprint = hash({ jobId: id, ...body });
      const prior = (
        await tx.query<{ payload_hash: string; result: GenerationAcceptResponse }>(
          'SELECT payload_hash,result FROM recollect.acceptance_receipts WHERE owner_id=$1 AND operation_id=$2',
          [owner, body.operationId],
        )
      ).rows[0];
      if (prior) {
        if (prior.payload_hash !== fingerprint)
          throw new DomainError('operation_id_reused', 'Acceptance ID has different content.', 409);
        return prior.result;
      }
      const job = (
        await tx.query<JobRow>(
          'SELECT * FROM recollect.generation_jobs WHERE owner_id=$1 AND id=$2 FOR UPDATE',
          [owner, id],
        )
      ).rows[0];
      if (!job) throw new DomainError('not_found', 'Generation not found.', 404);
      if (job.status !== 'succeeded')
        throw new DomainError(
          'generation_not_ready',
          'Only successful generation candidates can be accepted.',
          409,
        );
      const deck = await getDeck(tx, owner, job.deck_id);
      if (!deck || deck.deletedAt)
        throw new DomainError('entity_deleted', 'Destination deck was deleted.', 409);
      const chosen = [...new Set(body.candidateIds)];
      if (chosen.some((cid) => !job.candidates.some((c) => c.id === cid)))
        throw new DomainError('invalid_candidate', 'Candidate does not belong to this generation.');
      const cards: Card[] = [],
        created: Card[] = [],
        now = new Date().toISOString();
      for (const cid of chosen) {
        const candidate = job.candidates.find((c) => c.id === cid)!;
        const old = (
          await tx.query<{ data: Card }>(
            'SELECT data FROM recollect.cards WHERE owner_id=$1 AND id=$2',
            [owner, cid],
          )
        ).rows[0]?.data;
        if (old) {
          cards.push(old);
          continue;
        }
        const card: Card = {
          ...candidate,
          ownerId: owner,
          deckId: job.deck_id,
          aiGenerated: true,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 1,
          schedule: initialSchedule(now),
        };
        await insertCard(tx, card);
        cards.push(card);
        created.push(card);
      }
      const revision = created.length
        ? await appendChanges(
            tx,
            owner,
            created.map((data) => ({ entity: 'card' as const, data })),
          )
        : head.toString();
      const accepted = [...new Set([...job.accepted_candidate_ids, ...chosen])];
      await tx.query(
        'UPDATE recollect.generation_jobs SET accepted_candidate_ids=$3,updated_at=now() WHERE owner_id=$1 AND id=$2',
        [owner, id, JSON.stringify(accepted)],
      );
      const result = { cards, revision };
      await tx.query(
        'INSERT INTO recollect.acceptance_receipts(owner_id,operation_id,payload_hash,result) VALUES($1,$2,$3,$4)',
        [owner, body.operationId, fingerprint, result],
      );
      return result;
    });
  }
}
