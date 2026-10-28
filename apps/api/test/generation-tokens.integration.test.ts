import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generationJobSchema, type Deck, type GenerationRequest } from '@recollect/contracts';
import { ProviderError, type GenerationProvider } from '@recollect/ai';
import { createDatabase, lockOwner, transaction, type Database } from '@recollect/db';
import { migrate } from '@recollect/db/migrate';
import { GenerationService } from '../src/generations.js';
import { runGeneration } from '../../worker/src/worker.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('generation token acceptance', () => {
  let db: Database;
  let service: GenerationService;
  let owner: string;
  let deckId: string;
  const provider: GenerationProvider = {
    generate: async ({ count }) => ({
      cards: Array.from({ length: count }, (_, i) => ({
        front: `Term ${i + 1}`,
        back: `Answer ${i + 1}`,
        hint: '',
        explanation: '',
        tags: [],
      })),
      usage: {
        model: 'test',
        inputTokens: 2,
        outputTokens: 3,
        durationMs: 1,
        promptVersion: 'test',
      },
    }),
  };
  beforeAll(async () => {
    db = createDatabase(process.env.TEST_DATABASE_URL!);
    await db.query('DROP SCHEMA IF EXISTS recollect CASCADE');
    await migrate(db);
    service = new GenerationService(db, 1000, true);
  });
  beforeEach(async () => {
    await db.query('TRUNCATE recollect.users CASCADE');
    owner = randomUUID();
    deckId = randomUUID();
    await seedOwner(owner, deckId);
  });
  afterAll(async () => {
    await db?.end();
  });
  async function seedOwner(id: string, deck: string) {
    await db.query('INSERT INTO recollect.users(id,name) VALUES($1,$2)', [id, 'Test learner']);
    const now = new Date().toISOString();
    const data: Deck = {
      id: deck,
      ownerId: id,
      name: 'Test deck',
      description: '',
      color: '#112233',
      icon: '',
      isSilenced: false,
      silencedUntil: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await db.query('INSERT INTO recollect.decks(owner_id,id,data) VALUES($1,$2,$3)', [
      id,
      deck,
      data,
    ]);
  }
  const input = (changes: Partial<GenerationRequest> = {}): GenerationRequest => ({
    operationId: randomUUID(),
    deckId,
    prompt: 'Cell biology',
    count: 5,
    mode: 'cards',
    ...changes,
  });
  async function wallet() {
    const { tokenBalance } = await import('@recollect/db');
    return transaction(db, async (tx) => {
      await lockOwner(tx, owner);
      return tokenBalance(tx, owner);
    });
  }
  async function completed(changes: Partial<GenerationRequest> = {}) {
    const job = await service.create(owner, input(changes));
    expect(await runGeneration(db, provider, job.id)).toBe('completed');
    return service.get(owner, job.id);
  }
  const accept = (id: string, candidateIds: string[], operationId = randomUUID()) =>
    service.accept(owner, id, { operationId, candidateIds });

  it('reserves one token per batch, then charges once across subset acceptance and new operation IDs', async () => {
    const request = input({ count: 10 });
    const job = await service.create(owner, request);
    expect((await service.create(owner, request)).id).toBe(job.id);
    expect(await wallet()).toMatchObject({ available: 9, reserved: 1 });
    await runGeneration(db, provider, job.id);
    const finished = await service.get(owner, job.id);
    const firstId = finished.candidates[0]!.id;
    const receiptId = randomUUID();
    const saved = await accept(job.id, [firstId], receiptId);
    expect(await accept(job.id, [firstId], receiptId)).toEqual(saved);
    const all = await accept(
      job.id,
      finished.candidates.map((candidate) => candidate.id),
    );
    expect(all.cards).toHaveLength(10);
    expect(await wallet()).toMatchObject({ available: 9, reserved: 0 });
    expect((await db.query('SELECT count(*)::int n FROM recollect.cards')).rows[0].n).toBe(10);
    expect((await service.cancel(owner, job.id)).status).toBe('succeeded');
    expect(await wallet()).toMatchObject({ available: 9, reserved: 0 });
  });

  it('serializes competing requests for the last token and rolls back the losing job and daily quota', async () => {
    for (let i = 0; i < 9; i++) {
      const job = await completed({ count: 1 });
      await accept(job.id, [job.candidates[0]!.id]);
    }
    const before = (
      await db.query('SELECT reserved FROM recollect.quota_buckets WHERE owner_id=$1', [owner])
    ).rows[0].reserved;
    const results = await Promise.allSettled([
      service.create(owner, input({ count: 1 })),
      service.create(owner, input({ count: 1 })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'tokens_exhausted', statusCode: 402 });
    expect(await wallet()).toMatchObject({ available: 0, reserved: 1 });
    expect(
      (await db.query('SELECT count(*)::int n FROM recollect.generation_jobs')).rows[0].n,
    ).toBe(10);
    expect(
      (await db.query('SELECT reserved FROM recollect.quota_buckets WHERE owner_id=$1', [owner]))
        .rows[0].reserved,
    ).toBe(before + 1);
  });

  it('releases reservations for cancellation, discarded completed drafts, and terminal provider failure', async () => {
    const pending = await service.create(owner, input());
    await service.cancel(owner, pending.id);
    await service.cancel(owner, pending.id);
    expect(await runGeneration(db, provider, pending.id)).toBe('ignored');
    expect(await wallet()).toMatchObject({ available: 10, reserved: 0 });
    const draft = await completed();
    await service.cancel(owner, draft.id);
    await expect(accept(draft.id, [draft.candidates[0]!.id])).rejects.toMatchObject({
      code: 'generation_not_ready',
    });
    expect(await wallet()).toMatchObject({ available: 10, reserved: 0 });
    const failed = await service.create(owner, input());
    expect(
      await runGeneration(
        db,
        {
          generate: async () => {
            throw new ProviderError('rejected', 'No content', false);
          },
        },
        failed.id,
      ),
    ).toBe('failed');
    expect(await wallet()).toMatchObject({ available: 10, reserved: 0 });
  });

  it('keeps a retry reservation and releases a job that exhausts its worker attempts', async () => {
    const job = await service.create(owner, input());
    expect(
      await runGeneration(
        db,
        {
          generate: async () => {
            throw new ProviderError('busy', 'Try later', true);
          },
        },
        job.id,
      ),
    ).toBe('retry');
    expect(await wallet()).toMatchObject({ available: 9, reserved: 1 });
    await db.query(
      "UPDATE recollect.generation_jobs SET attempt=3,available_at=now()-interval '1 second' WHERE id=$1",
      [job.id],
    );
    expect(await runGeneration(db, provider, job.id)).toBe('ignored');
    expect((await service.get(owner, job.id)).status).toBe('failed');
    expect(await wallet()).toMatchObject({ available: 10, reserved: 0 });
  });

  it('charges an explicitly accepted answer once without creating a second card or sync revision', async () => {
    const job = await completed({ mode: 'answer', count: 1 });
    expect(await wallet()).toMatchObject({ available: 9, reserved: 1 });
    const operationId = randomUUID();
    const first = await service.acceptAnswer(owner, job.id, { operationId });
    expect(first).toEqual({ answer: 'Answer 1', tokenCharged: true });
    expect(await service.acceptAnswer(owner, job.id, { operationId })).toEqual(first);
    expect(await service.acceptAnswer(owner, job.id, { operationId: randomUUID() })).toEqual({
      answer: 'Answer 1',
      tokenCharged: false,
    });
    expect((await db.query('SELECT count(*)::int n FROM recollect.cards')).rows[0].n).toBe(0);
    expect(
      (await db.query('SELECT revision::text FROM recollect.sync_heads WHERE owner_id=$1', [owner]))
        .rows[0].revision,
    ).toBe('0');
    expect(await wallet()).toMatchObject({ available: 9, reserved: 0 });
    expect((await service.cancel(owner, job.id)).status).toBe('succeeded');
  });

  it('does not charge failed validation, wrong modes, foreign jobs, or reused acceptance IDs', async () => {
    const cards = await completed();
    const answer = await completed({ mode: 'answer', count: 1 });
    await expect(
      service.acceptAnswer(owner, cards.id, { operationId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'invalid_generation_mode' });
    await expect(accept(answer.id, [answer.candidates[0]!.id])).rejects.toMatchObject({
      code: 'invalid_generation_mode',
    });
    await expect(accept(cards.id, [randomUUID()])).rejects.toMatchObject({
      code: 'invalid_candidate',
    });
    const other = randomUUID();
    await seedOwner(other, randomUUID());
    await expect(
      service.acceptAnswer(other, answer.id, { operationId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await wallet()).toMatchObject({ available: 8, reserved: 2 });
    const operationId = randomUUID();
    await accept(cards.id, [cards.candidates[0]!.id], operationId);
    await expect(service.acceptAnswer(owner, answer.id, { operationId })).rejects.toMatchObject({
      code: 'operation_id_reused',
    });
    expect(await wallet()).toMatchObject({ available: 8, reserved: 1 });
    await expect(service.create(owner, input({ mode: 'answer', count: 2 }))).rejects.toMatchObject({
      code: 'invalid_generation_mode',
    });
  });

  // The WASM socket adapter misorders wire messages after a SQL constraint failure.
  // PostgreSQL CI runs the real rollback path and the local PG integration run covers it.
  it.skipIf(process.env.RECOLLECT_EMBEDDED_TEST === 'true')(
    'rolls back capture if card insertion fails and allows the same acceptance to resume',
    async () => {
      const job = await completed({ count: 1 });
      await db.query(
        "ALTER TABLE recollect.cards ADD CONSTRAINT test_reject_generation CHECK ((data->>'aiGenerated')::boolean = false)",
      );
      const operationId = randomUUID();
      try {
        await expect(accept(job.id, [job.candidates[0]!.id], operationId)).rejects.toThrow();
        expect(await wallet()).toMatchObject({ available: 9, reserved: 1 });
        expect((await service.get(owner, job.id)).acceptedCandidateIds).toEqual([]);
      } finally {
        await db.query('ALTER TABLE recollect.cards DROP CONSTRAINT test_reject_generation');
      }
      expect((await accept(job.id, [job.candidates[0]!.id], operationId)).cards).toHaveLength(1);
      expect(await wallet()).toMatchObject({ available: 9, reserved: 0 });
    },
  );

  it('snapshots rollout so legacy jobs stay free and enabled jobs retain their capture after rollout pauses', async () => {
    const legacy = new GenerationService(db, 1000);
    const free = await legacy.create(owner, input({ count: 1 }));
    await runGeneration(db, provider, free.id);
    const legacyDraft = await service.get(owner, free.id);
    await accept(free.id, [legacyDraft.candidates[0]!.id]);
    expect(await wallet()).toMatchObject({ available: 10, reserved: 0 });
    const enabled = await completed({ count: 1 });
    await legacy.accept(owner, enabled.id, {
      operationId: randomUUID(),
      candidateIds: [enabled.candidates[0]!.id],
    });
    expect(await wallet()).toMatchObject({ available: 9, reserved: 0 });
  });

  it('keeps the reviewed client protocol unchanged while requiring explicit token-aware mode after rollout', async () => {
    const legacy = new GenerationService(db, 1000);
    const request = input({ mode: undefined, count: 1 });
    const free = await legacy.create(owner, request);
    expect(generationJobSchema.parse(free)).toEqual(free);
    expect(await service.create(owner, request)).toEqual(free);
    await expect(
      service.create(owner, { ...request, operationId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'upgrade_required', statusCode: 426 });
    expect(await wallet()).toMatchObject({ available: 10, reserved: 0 });
  });

  it('cancels a lost-response request by operation and blocks delayed creation without sending another prompt', async () => {
    const unknown = input();
    expect(await service.cancelByOperation(owner, unknown.operationId)).toEqual({ canceled: true });
    await expect(service.create(owner, unknown)).rejects.toMatchObject({
      code: 'generation_canceled',
    });
    expect(await wallet()).toMatchObject({ available: 10, reserved: 0 });
    const request = input();
    const job = await service.create(owner, request);
    expect(await service.cancelByOperation(owner, request.operationId)).toEqual({ canceled: true });
    expect((await service.get(owner, job.id)).status).toBe('canceled');
    expect(await wallet()).toMatchObject({ available: 10, reserved: 0 });
    const accepted = await completed({ count: 1 });
    await accept(accepted.id, [accepted.candidates[0]!.id]);
    const operationId = (
      await db.query('SELECT operation_id FROM recollect.generation_jobs WHERE id=$1', [
        accepted.id,
      ])
    ).rows[0].operation_id;
    expect(await service.cancelByOperation(owner, operationId)).toEqual({ canceled: false });
    expect((await service.get(owner, accepted.id)).status).toBe('succeeded');
  });
});
