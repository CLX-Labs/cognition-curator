import type {
  Card,
  Deck,
  ReviewEvent,
  ScheduleState,
  Snapshot,
  SyncOperation,
  SyncReceipt,
  PullResponse,
  User,
} from '@recollect/contracts';
import { initialSchedule, replayReviews } from '@recollect/scheduler';
import {
  appendChanges,
  DomainError,
  hash,
  lockOwner,
  transaction,
  type Change,
  type Database,
  type Transaction,
} from '@recollect/db';
import { assertDeckImage } from './deck-images.js';

export async function getDeck(
  tx: Transaction,
  owner: string,
  id: string,
): Promise<Deck | undefined> {
  return (
    await tx.query<{ data: Deck }>('SELECT data FROM recollect.decks WHERE owner_id=$1 AND id=$2', [
      owner,
      id,
    ])
  ).rows[0]?.data;
}
export async function getCard(
  tx: Transaction,
  owner: string,
  id: string,
): Promise<Card | undefined> {
  return (
    await tx.query<{ data: Card }>('SELECT data FROM recollect.cards WHERE owner_id=$1 AND id=$2', [
      owner,
      id,
    ])
  ).rows[0]?.data;
}
export async function saveDeck(tx: Transaction, deck: Deck): Promise<void> {
  assertDeckImage(deck.imageDataUrl);
  await tx.query(
    'INSERT INTO recollect.decks(owner_id,id,data) VALUES($1,$2,$3) ON CONFLICT(owner_id,id) DO UPDATE SET data=excluded.data',
    [deck.ownerId, deck.id, deck],
  );
}
export async function insertCard(
  tx: Transaction,
  card: Card,
  checkpointAt = card.createdAt,
): Promise<void> {
  await tx.query(
    'INSERT INTO recollect.cards(owner_id,id,deck_id,data,checkpoint,checkpoint_at) VALUES($1,$2,$3,$4,$5,$6)',
    [card.ownerId, card.id, card.deckId, card, card.schedule, checkpointAt],
  );
}
export async function saveCard(tx: Transaction, card: Card): Promise<void> {
  await tx.query('UPDATE recollect.cards SET data=$3,deck_id=$4 WHERE owner_id=$1 AND id=$2', [
    card.ownerId,
    card.id,
    card,
    card.deckId,
  ]);
}
function checkClock(value: string): void {
  if (Date.parse(value) > Date.now() + 300_000)
    throw new DomainError('clock_in_future', 'The device clock is more than five minutes ahead.');
}
export async function applyOperation(
  tx: Transaction,
  owner: string,
  op: SyncOperation,
): Promise<SyncReceipt> {
  checkClock(op.createdAt);
  const now = new Date().toISOString();
  const changes: Change[] = [];
  let canonical: SyncReceipt['canonical'];
  if (op.type === 'deck.upsert' || op.type === 'deck.delete') {
    const existing = await getDeck(tx, owner, op.payload.id);
    if ((existing?.version ?? 0) !== op.baseVersion)
      return {
        operationId: op.operationId,
        status: 'conflict',
        ...(existing ? { canonical: { entity: 'deck', data: existing } } : {}),
        error: { code: 'version_conflict', message: 'Deck changed on another device.' },
      };
    if (existing?.deletedAt)
      throw new DomainError(
        'entity_deleted',
        'This deck was deleted. Recover it with a new identity.',
      );
    let deck: Deck;
    if (op.type === 'deck.delete') {
      if (!existing) throw new DomainError('not_found', 'Deck not found.', 404);
      deck = { ...existing, deletedAt: now, updatedAt: now, version: existing.version + 1 };
      const children = await tx.query<{ data: Card }>(
        'SELECT data FROM recollect.cards WHERE owner_id=$1 AND deck_id=$2',
        [owner, deck.id],
      );
      for (const { data } of children.rows)
        if (!data.deletedAt) {
          const child = { ...data, deletedAt: now, updatedAt: now, version: data.version + 1 };
          await saveCard(tx, child);
          changes.push({ entity: 'card', data: child });
        }
    } else
      deck = {
        ...op.payload,
        ...(op.payload.imageDataUrl === undefined && existing?.imageDataUrl !== undefined
          ? { imageDataUrl: existing.imageDataUrl }
          : {}),
        ownerId: owner,
        createdAt: existing?.createdAt ?? op.createdAt,
        updatedAt: now,
        deletedAt: null,
        version: (existing?.version ?? 0) + 1,
      };
    await saveDeck(tx, deck);
    changes.unshift({ entity: 'deck', data: deck });
    canonical = { entity: 'deck', data: deck };
  } else if (op.type === 'card.upsert' || op.type === 'card.delete') {
    const existing = await getCard(tx, owner, op.payload.id);
    if ((existing?.version ?? 0) !== op.baseVersion)
      return {
        operationId: op.operationId,
        status: 'conflict',
        ...(existing ? { canonical: { entity: 'card', data: existing } } : {}),
        error: { code: 'version_conflict', message: 'Card changed on another device.' },
      };
    if (existing?.deletedAt)
      throw new DomainError(
        'entity_deleted',
        'This card was deleted. Recover it with a new identity.',
      );
    let card: Card;
    if (op.type === 'card.delete') {
      if (!existing) throw new DomainError('not_found', 'Card not found.', 404);
      card = { ...existing, deletedAt: now, updatedAt: now, version: existing.version + 1 };
    } else {
      const deck = await getDeck(tx, owner, op.payload.deckId);
      if (!deck || deck.deletedAt)
        throw new DomainError('not_found', 'An active owned deck is required.', 404);
      // Moving reviewed cards between decks needs an explicit history policy. Preserve ownership/history here.
      if (existing && existing.deckId !== op.payload.deckId)
        throw new DomainError('move_not_supported', 'Create a copy to move a card between decks.');
      card = {
        ...op.payload,
        ownerId: owner,
        createdAt: existing?.createdAt ?? op.createdAt,
        updatedAt: now,
        deletedAt: null,
        version: (existing?.version ?? 0) + 1,
        schedule: existing?.schedule ?? initialSchedule(op.createdAt),
      };
    }
    if (existing) await saveCard(tx, card);
    else await insertCard(tx, card);
    changes.push({ entity: 'card', data: card });
    canonical = { entity: 'card', data: card };
  } else {
    const event = op.payload;
    checkClock(event.reviewedAt);
    const card = await getCard(tx, owner, event.cardId);
    if (!card || card.deletedAt || card.deckId !== event.deckId)
      throw new DomainError('not_found', 'An active owned card is required.', 404);
    const deck = await getDeck(tx, owner, card.deckId);
    if (!deck || deck.deletedAt) throw new DomainError('not_found', 'Deck was deleted.', 404);
    const old = (
      await tx.query<{ payload_hash: string }>(
        'SELECT payload_hash FROM recollect.review_events WHERE owner_id=$1 AND id=$2',
        [owner, event.id],
      )
    ).rows[0];
    if (old) {
      if (old.payload_hash !== hash(event))
        throw new DomainError(
          'event_id_reused',
          'A review ID cannot identify different content.',
          409,
        );
      const head = (
        await tx.query<{ revision: string }>(
          'SELECT revision::text FROM recollect.sync_heads WHERE owner_id=$1',
          [owner],
        )
      ).rows[0]!;
      return {
        operationId: op.operationId,
        status: 'duplicate',
        revision: head.revision,
        canonical: { entity: 'card', data: card },
      };
    }
    const checkpoint = (
      await tx.query<{ checkpoint: ScheduleState; checkpoint_at: Date }>(
        'SELECT checkpoint,checkpoint_at FROM recollect.cards WHERE owner_id=$1 AND id=$2',
        [owner, card.id],
      )
    ).rows[0]!;
    if (Date.parse(event.reviewedAt) < checkpoint.checkpoint_at.getTime())
      throw new DomainError(
        'before_checkpoint',
        'This review predates the recoverable schedule checkpoint; retain it for recovery.',
      );
    const seq = await tx.query(
      'SELECT 1 FROM recollect.review_events WHERE owner_id=$1 AND device_id=$2 AND device_sequence=$3',
      [owner, event.deviceId, event.deviceSequence],
    );
    if (seq.rowCount)
      throw new DomainError(
        'device_sequence_reused',
        'A device sequence cannot identify a second review.',
        409,
      );
    await tx.query(
      'INSERT INTO recollect.review_events(owner_id,id,card_id,device_id,device_sequence,reviewed_at,payload_hash,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        owner,
        event.id,
        event.cardId,
        event.deviceId,
        event.deviceSequence,
        event.reviewedAt,
        hash(event),
        event,
      ],
    );
    const history = (
      await tx.query<{ data: ReviewEvent }>(
        'SELECT data FROM recollect.review_events WHERE owner_id=$1 AND card_id=$2',
        [owner, card.id],
      )
    ).rows.map((r) => r.data);
    const updated = {
      ...card,
      schedule: replayReviews(checkpoint.checkpoint, history),
      version: card.version + 1,
      updatedAt: now,
    };
    await saveCard(tx, updated);
    changes.push({ entity: 'review', data: event }, { entity: 'card', data: updated });
    canonical = { entity: 'card', data: updated };
  }
  const revision = await appendChanges(tx, owner, changes);
  return {
    operationId: op.operationId,
    status: 'accepted',
    revision,
    ...(canonical ? { canonical } : {}),
  };
}
export class SyncService {
  constructor(readonly db: Database) {}
  async push(owner: string, operations: SyncOperation[]): Promise<{ receipts: SyncReceipt[] }> {
    const receipts: SyncReceipt[] = [];
    for (const op of operations) {
      const receipt = await transaction(this.db, async (tx) => {
        await lockOwner(tx, owner);
        const old = (
          await tx.query<{ payload_hash: string; result: SyncReceipt }>(
            'SELECT payload_hash,result FROM recollect.operation_receipts WHERE owner_id=$1 AND operation_id=$2',
            [owner, op.operationId],
          )
        ).rows[0];
        if (old) {
          if (old.payload_hash !== hash(op))
            return {
              operationId: op.operationId,
              status: 'rejected' as const,
              error: {
                code: 'operation_id_reused',
                message: 'Operation ID was already used with different content.',
              },
            };
          return {
            ...old.result,
            status: old.result.status === 'accepted' ? ('duplicate' as const) : old.result.status,
          };
        }
        let result: SyncReceipt;
        await tx.query('SAVEPOINT operation_effect');
        try {
          result = await applyOperation(tx, owner, op);
        } catch (error) {
          await tx.query('ROLLBACK TO SAVEPOINT operation_effect');
          if (error instanceof DomainError)
            result = {
              operationId: op.operationId,
              status: 'rejected',
              error: { code: error.code, message: error.message },
            };
          else if ((error as { code?: string }).code === '23505')
            result = {
              operationId: op.operationId,
              status: 'rejected',
              error: {
                code: 'identity_conflict',
                message:
                  'This entity identity is already in use. Preserve the local record for recovery.',
              },
            };
          else throw error;
        }
        await tx.query(
          'INSERT INTO recollect.operation_receipts(owner_id,operation_id,payload_hash,result) VALUES($1,$2,$3,$4)',
          [owner, op.operationId, hash(op), result],
        );
        return result;
      });
      receipts.push(receipt);
    }
    return { receipts };
  }
  async pull(
    owner: string,
    cursor: string,
    until: string | undefined,
    limit: number,
  ): Promise<PullResponse> {
    return transaction(this.db, async (tx) => {
      const head = await lockOwner(tx, owner),
        high = until ? BigInt(until) : head;
      if (high > head || BigInt(cursor) > high)
        throw new DomainError(
          'invalid_cursor',
          'Cursor or high watermark is ahead of this account.',
        );
      // Entire revision groups are returned. The SQL limit counts revisions, never individual changes.
      const revisions = (
        await tx.query<{ revision: string }>(
          'SELECT DISTINCT revision::text,revision AS ordering FROM recollect.changes WHERE owner_id=$1 AND revision>$2 AND revision<=$3 ORDER BY ordering LIMIT $4',
          [owner, cursor, high.toString(), limit + 1],
        )
      ).rows;
      const page = revisions.slice(0, limit),
        end = page.at(-1)?.revision ?? cursor;
      const changes = (
        await tx.query<{
          revision: string;
          entity: 'deck' | 'card' | 'review';
          data: Deck | Card | ReviewEvent;
        }>(
          'SELECT c.revision::text,c.entity,c.data FROM recollect.changes c WHERE c.owner_id=$1 AND c.revision>$2 AND c.revision<=$3 ORDER BY c.revision,c.ordinal',
          [owner, cursor, end],
        )
      ).rows;
      return {
        cursor: revisions.length <= limit ? high.toString() : end,
        highWatermark: high.toString(),
        hasMore: revisions.length > limit,
        changes,
      } as PullResponse;
    });
  }
  async snapshot(owner: string): Promise<Snapshot> {
    return transaction(this.db, async (tx) => {
      const head = await lockOwner(tx, owner);
      const user = (
        await tx.query<User>('SELECT id,email,name FROM recollect.users WHERE id=$1', [owner])
      ).rows[0]!;
      const decks = (
        await tx.query<{ data: Deck }>(
          'SELECT data FROM recollect.decks WHERE owner_id=$1 ORDER BY id',
          [owner],
        )
      ).rows.map((r) => r.data);
      const cards = (
        await tx.query<{ data: Card }>(
          'SELECT data FROM recollect.cards WHERE owner_id=$1 ORDER BY id',
          [owner],
        )
      ).rows.map((r) => r.data);
      const reviews = (
        await tx.query<{ data: ReviewEvent }>(
          'SELECT data FROM recollect.review_events WHERE owner_id=$1 ORDER BY reviewed_at,id',
          [owner],
        )
      ).rows.map((r) => r.data);
      return { user, cursor: head.toString(), decks, cards, reviews };
    });
  }
}
