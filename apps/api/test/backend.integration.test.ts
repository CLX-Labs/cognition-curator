import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  cardSchema,
  deckSchema,
  importResponseSchema,
  pullResponseSchema,
  pushResponseSchema,
  sessionSchema,
  snapshotSchema,
  type ReviewEvent,
  type Session,
  type SyncOperation,
} from '@recollect/contracts';
import { initialSchedule, replayReviews } from '@recollect/scheduler';
import { createDatabase, secretHash, type Database } from '@recollect/db';
import { migrate } from '@recollect/db/migrate';
import { ProviderError, type GenerationProvider } from '@recollect/ai';
import { buildApp } from '../src/app.js';
import type { ApiConfig } from '../src/config.js';
import { dispatchPending, recoverAbandonedJobs, runGeneration } from '../../worker/src/worker.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('PostgreSQL backend integration', () => {
  let db: Database, app: FastifyInstance;
  const config: ApiConfig = {
    databaseUrl: process.env.TEST_DATABASE_URL ?? '',
    accessSecret: 'test-only-strong-signing-key-32-characters',
    appleAudience: 'test.recollect',
    production: false,
    enableDevAuth: false,
    accessTtlSeconds: 900,
    refreshTtlSeconds: 86400,
    dailyGenerationCards: 3,
  };
  const deviceId = randomUUID(),
    createdAt = new Date(Date.now() - 86400_000).toISOString();
  beforeAll(async () => {
    db = createDatabase(config.databaseUrl);
    await db.query('DROP SCHEMA IF EXISTS recollect CASCADE');
    await migrate(db);
    app = await buildApp({ db, config, appleVerifier: async (token) => JSON.parse(token) });
  });
  beforeEach(async () => {
    await db.query(
      'TRUNCATE recollect.users,recollect.auth_challenges,recollect.rate_buckets CASCADE',
    );
    await db.query('DROP TABLE IF EXISTS public.users CASCADE');
  });
  afterAll(async () => {
    await app?.close();
    await db?.end();
  });
  async function login(subject = randomUUID()): Promise<Session> {
    const challenge = (
      await app.inject({ method: 'POST', url: '/v1/auth/apple/challenge' })
    ).json();
    const r = await app.inject({
      method: 'POST',
      url: '/v1/auth/apple',
      payload: {
        challengeId: challenge.challengeId,
        identityToken: JSON.stringify({
          sub: subject,
          nonce: secretHash(challenge.nonce),
          email: subject + '@example.test',
        }),
        displayName: 'Test learner',
      },
    });
    expect(r.statusCode, r.body).toBe(200);
    return sessionSchema.parse(r.json());
  }
  const headers = (s: Session) => ({ authorization: 'Bearer ' + s.accessToken });
  const deckOp = (id = randomUUID()): SyncOperation => ({
    operationId: randomUUID(),
    deviceId,
    createdAt,
    type: 'deck.upsert',
    baseVersion: 0,
    payload: {
      id,
      name: 'Biology',
      description: '',
      color: '#112233',
      icon: '',
      isSilenced: false,
      silencedUntil: null,
    },
  });
  const cardOp = (deckId: string, id: string = randomUUID()): SyncOperation => ({
    operationId: randomUUID(),
    deviceId,
    createdAt,
    type: 'card.upsert',
    baseVersion: 0,
    payload: {
      id,
      deckId,
      front: 'Question',
      back: 'Answer',
      hint: '',
      explanation: '',
      tags: [],
      aiGenerated: false,
    },
  });
  async function push(s: Session, ...operations: SyncOperation[]) {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: headers(s),
      payload: { operations },
    });
    expect(r.statusCode, r.body).toBe(200);
    return pushResponseSchema.parse(r.json());
  }
  async function setup(s: Session) {
    const d = deckOp();
    const c = cardOp(d.payload.id);
    const out = await push(s, d, c);
    expect(out.receipts.map((r) => r.status)).toEqual(['accepted', 'accepted']);
    return { deckId: d.payload.id, cardId: c.payload.id };
  }
  const event = (deckId: string, cardId: string, seq: number, at: string): ReviewEvent => ({
    id: randomUUID(),
    deckId,
    cardId,
    deviceId,
    deviceSequence: seq,
    reviewedAt: at,
    rating: 'good',
    elapsedMs: 2000,
    algorithmVersion: 'sm2-v1',
  });
  const reviewOp = (payload: ReturnType<typeof event>): SyncOperation => ({
    operationId: randomUUID(),
    deviceId,
    createdAt: new Date().toISOString(),
    type: 'review.append',
    payload,
  });

  it('consumes a one-time nonce and rejects replay and arbitrary old access tokens', async () => {
    const challenge = (
      await app.inject({ method: 'POST', url: '/v1/auth/apple/challenge' })
    ).json();
    const payload = {
      challengeId: challenge.challengeId,
      identityToken: JSON.stringify({ sub: randomUUID(), nonce: secretHash(challenge.nonce) }),
    };
    expect((await app.inject({ method: 'POST', url: '/v1/auth/apple', payload })).statusCode).toBe(
      200,
    );
    expect((await app.inject({ method: 'POST', url: '/v1/auth/apple', payload })).statusCode).toBe(
      401,
    );
    expect(
      (
        await app.inject({
          url: '/v1/snapshot',
          headers: { authorization: 'Bearer old-python-token' },
        })
      ).statusCode,
    ).toBe(401);
    expect((await app.inject({ url: '/api/decks/' })).statusCode).toBe(426);
  });
  it('rejects a wrong nonce without consuming the challenge', async () => {
    const challenge = (
      await app.inject({ method: 'POST', url: '/v1/auth/apple/challenge' })
    ).json();
    const payload = {
      challengeId: challenge.challengeId,
      identityToken: JSON.stringify({ sub: randomUUID(), nonce: 'wrong' }),
    };
    expect((await app.inject({ method: 'POST', url: '/v1/auth/apple', payload })).statusCode).toBe(
      401,
    );
    expect(
      (await db.query('SELECT consumed_at FROM recollect.auth_challenges')).rows[0].consumed_at,
    ).toBeNull();
  });
  it('preserves a verified legacy UUID and rejects an inactive legacy identity', async () => {
    await db.query(
      'CREATE TABLE public.users(id uuid PRIMARY KEY,apple_id text,email text,name text,is_active boolean)',
    );
    const activeId = randomUUID(),
      activeSubject = randomUUID(),
      inactiveSubject = randomUUID();
    await db.query('INSERT INTO public.users VALUES($1,$2,$3,$4,true),($5,$6,$7,$8,false)', [
      activeId,
      activeSubject,
      'active@example.test',
      'Active',
      randomUUID(),
      inactiveSubject,
      'inactive@example.test',
      'Inactive',
    ]);
    expect((await login(activeSubject)).user.id).toBe(activeId);
    const challenge = (
      await app.inject({ method: 'POST', url: '/v1/auth/apple/challenge' })
    ).json();
    const r = await app.inject({
      method: 'POST',
      url: '/v1/auth/apple',
      payload: {
        challengeId: challenge.challengeId,
        identityToken: JSON.stringify({ sub: inactiveSubject, nonce: secretHash(challenge.nonce) }),
      },
    });
    expect(r.statusCode).toBe(403);
    expect((await db.query('SELECT count(*)::int AS n FROM recollect.users')).rows[0].n).toBe(1);
  });
  it('serializes refresh-family reuse and revokes every concurrent descendant', async () => {
    const first = await login();
    const second = sessionSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/auth/refresh',
          payload: { refreshToken: first.refreshToken },
        })
      ).json(),
    );
    const outcomes = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: first.refreshToken },
      }),
      app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: second.refreshToken },
      }),
    ]);
    expect(outcomes[0]!.statusCode).toBe(401);
    for (const session of [
      first,
      second,
      ...outcomes.filter((r) => r.statusCode === 200).map((r) => sessionSchema.parse(r.json())),
    ])
      expect(
        (await app.inject({ url: '/v1/snapshot', headers: headers(session) })).statusCode,
      ).toBe(401);
    expect(
      (
        await db.query(
          'SELECT count(*)::int n FROM recollect.session_families WHERE revoked_at IS NULL',
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('keeps temporary database failure distinct from invalid credentials', async () => {
    const s = await login(),
      query = vi.spyOn(db, 'query');
    query.mockRejectedValueOnce(new Error('Temporary database connection failure'));
    try {
      expect((await app.inject({ url: '/v1/sync/snapshot', headers: headers(s) })).statusCode).toBe(
        500,
      );
    } finally {
      query.mockRestore();
    }
    expect((await app.inject({ url: '/v1/sync/snapshot', headers: headers(s) })).statusCode).toBe(
      200,
    );
  });
  it('keeps content owner-separated and reports optimistic edit conflicts', async () => {
    const a = await login(),
      b = await login(),
      ids = await setup(a);
    const attack = cardOp(ids.deckId);
    expect((await push(b, attack)).receipts[0]!.status).toBe('rejected');
    const snapshot = snapshotSchema.parse(
      (await app.inject({ url: '/v1/snapshot', headers: headers(b) })).json(),
    );
    expect(snapshot.cards).toHaveLength(0);
    expect(snapshot.decks).toHaveLength(0);
    const stale = cardOp(ids.deckId, ids.cardId);
    const conflict = (await push(a, stale)).receipts[0]!;
    expect(conflict.status).toBe('conflict');
    expect(conflict.canonical?.entity).toBe('card');
  });
  it('deduplicates operation IDs and independent review IDs and deterministically replays late events', async () => {
    const s = await login(),
      ids = await setup(s),
      early = event(
        ids.deckId,
        ids.cardId,
        1,
        new Date(Date.parse(createdAt) + 60_000).toISOString(),
      ),
      late = event(
        ids.deckId,
        ids.cardId,
        2,
        new Date(Date.parse(createdAt) + 120_000).toISOString(),
      );
    const lateOp = reviewOp(late),
      earlyOp = reviewOp(early);
    expect((await push(s, lateOp, earlyOp, lateOp)).receipts.map((r) => r.status)).toEqual([
      'accepted',
      'accepted',
      'duplicate',
    ]);
    expect((await push(s, reviewOp(late))).receipts[0]!.status).toBe('duplicate');
    expect((await push(s, reviewOp({ ...late, rating: 'hard' }))).receipts[0]!.error?.code).toBe(
      'event_id_reused',
    );
    const snapshot = snapshotSchema.parse(
      (await app.inject({ url: '/v1/snapshot', headers: headers(s) })).json(),
    );
    expect(snapshot.reviews).toHaveLength(2);
    expect(snapshot.cards[0]!.schedule).toEqual(
      replayReviews(initialSchedule(createdAt), [early, late]),
    );
    expect(snapshot.cursor).toBe('4');
  });
  it('serializes concurrent writes so cursor groups are complete and never skip commits', async () => {
    const s = await login(),
      ids = await setup(s);
    await Promise.all([
      push(
        s,
        reviewOp(
          event(ids.deckId, ids.cardId, 1, new Date(Date.parse(createdAt) + 60_000).toISOString()),
        ),
      ),
      push(
        s,
        reviewOp(
          event(ids.deckId, ids.cardId, 2, new Date(Date.parse(createdAt) + 120_000).toISOString()),
        ),
      ),
    ]);
    const first = pullResponseSchema.parse(
      (await app.inject({ url: '/v1/sync/pull?cursor=2&limit=1', headers: headers(s) })).json(),
    );
    expect(first.changes).toHaveLength(2);
    expect(first.cursor).toBe('3');
    expect(first.highWatermark).toBe('4');
    expect(first.hasMore).toBe(true);
    await push(
      s,
      reviewOp(
        event(ids.deckId, ids.cardId, 3, new Date(Date.parse(createdAt) + 180_000).toISOString()),
      ),
    );
    const second = pullResponseSchema.parse(
      (
        await app.inject({ url: '/v1/sync/pull?cursor=3&until=4&limit=1', headers: headers(s) })
      ).json(),
    );
    expect(second.changes).toHaveLength(2);
    expect(second.cursor).toBe('4');
    expect(second.hasMore).toBe(false);
  });
  it('propagates deck tombstones to cards and excludes them from due counts', async () => {
    const s = await login(),
      ids = await setup(s);
    await push(s, {
      operationId: randomUUID(),
      deviceId,
      createdAt: new Date().toISOString(),
      type: 'deck.delete',
      baseVersion: 1,
      payload: { id: ids.deckId },
    });
    const snap = snapshotSchema.parse(
      (await app.inject({ url: '/v1/snapshot', headers: headers(s) })).json(),
    );
    expect(snap.cards[0]!.deletedAt).not.toBeNull();
    expect(snap.decks[0]!.deletedAt).not.toBeNull();
    expect((await app.inject({ url: '/v1/progress', headers: headers(s) })).json().dueCards).toBe(
      0,
    );
  });
  it('imports a checkpoint once, archives old history, requires owner confirmation and rejects pre-checkpoint replay', async () => {
    const s = await login(),
      d = deckOp(),
      c = cardOp(d.payload.id),
      checkpointAt = new Date().toISOString();
    const body = {
      batchId: randomUUID(),
      source: 'swiftdata-v1',
      sourceAccountId: null,
      ownershipConfirmed: true,
      exportedAt: checkpointAt,
      decks: [d.payload],
      cards: [{ ...c.payload, schedule: initialSchedule(checkpointAt), checkpointAt }],
      archivedReviews: [{ legacyId: 'kept-as-evidence', intervalMinutes: 1440 }],
      rawManifest: { formatVersion: 1, pendingOps: [{ unreliable: true }] },
    };
    const first = await app.inject({
      method: 'POST',
      url: '/v1/imports',
      headers: headers(s),
      payload: body,
    });
    expect(first.statusCode, first.body).toBe(200);
    const result = importResponseSchema.parse(first.json());
    expect(result.importedCardIds).toHaveLength(1);
    expect(
      (
        await app.inject({ method: 'POST', url: '/v1/imports', headers: headers(s), payload: body })
      ).json(),
    ).toEqual(result);
    expect((await db.query('SELECT count(*)::int n FROM recollect.review_events')).rows[0].n).toBe(
      0,
    );
    const rejected = (await push(s, reviewOp(event(d.payload.id, c.payload.id, 1, createdAt))))
      .receipts[0]!;
    expect(rejected.error?.code).toBe('before_checkpoint');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/imports',
          headers: headers(s),
          payload: { ...body, batchId: randomUUID(), ownershipConfirmed: false },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await db.query('SELECT manifest FROM recollect.import_batches')).rows[0].manifest.rawManifest
        .pendingOps,
    ).toHaveLength(1);
  });
  it('preserves a fractional legacy interval and high ease until the next new review', async () => {
    const s = await login(),
      d = deckOp(),
      c = cardOp(d.payload.id),
      checkpointAt = new Date(Date.now() - 1000).toISOString();
    const schedule = {
      ...initialSchedule(checkpointAt),
      phase: 'review',
      intervalSeconds: 90.5,
      easeFactor: 3.1,
      repetitions: 2,
      totalReviews: 5,
      lastReviewedAt: checkpointAt,
      dueAt: new Date(Date.parse(checkpointAt) + 90_500).toISOString(),
    };
    const body = {
      batchId: randomUUID(),
      source: 'swiftdata-v1',
      sourceAccountId: null,
      ownershipConfirmed: true,
      exportedAt: checkpointAt,
      decks: [d.payload],
      cards: [{ ...c.payload, schedule, checkpointAt }],
      archivedReviews: [],
    };
    const imported = await app.inject({
      method: 'POST',
      url: '/v1/imports',
      headers: headers(s),
      payload: body,
    });
    expect(imported.statusCode, imported.body).toBe(200);
    const checkpoint = (
      await db.query('SELECT checkpoint,data FROM recollect.cards WHERE id=$1', [c.payload.id])
    ).rows[0]!;
    expect(checkpoint.checkpoint).toEqual(schedule);
    expect(checkpoint.data.schedule).toEqual(schedule);
    const before = snapshotSchema.parse(
      (await app.inject({ url: '/v1/sync/snapshot', headers: headers(s) })).json(),
    );
    expect(before.cards[0]!.schedule).toEqual(schedule);
    expect(
      (await push(s, reviewOp(event(d.payload.id, c.payload.id, 1, new Date().toISOString()))))
        .receipts[0]!.status,
    ).toBe('accepted');
    const after = snapshotSchema.parse(
      (await app.inject({ url: '/v1/sync/snapshot', headers: headers(s) })).json(),
    );
    expect(after.cards[0]!.schedule.easeFactor).toBeLessThanOrEqual(3);
    expect(Number.isInteger(after.cards[0]!.schedule.intervalSeconds)).toBe(true);
    expect(
      (await db.query('SELECT checkpoint FROM recollect.cards WHERE id=$1', [c.payload.id])).rows[0]
        .checkpoint,
    ).toEqual(schedule);
  });
  const provider = (front = 'Generated'): GenerationProvider => ({
    generate: async ({ count }) => ({
      cards: Array.from({ length: count }, () => ({
        front,
        back: 'Answer',
        hint: '',
        explanation: '',
        tags: [],
      })),
      usage: {
        model: 'test',
        inputTokens: 5,
        outputTokens: 5,
        durationMs: 1,
        promptVersion: 'test',
      },
    }),
  });
  async function generate(s: Session, deckId: string, count = 2) {
    const payload = {
      operationId: randomUUID(),
      deckId,
      prompt: 'Cell biology fundamentals',
      count,
    };
    const r = await app.inject({
      method: 'POST',
      url: '/v1/generations',
      headers: headers(s),
      payload,
    });
    expect(r.statusCode, r.body).toBe(202);
    return { job: r.json(), payload };
  }
  it('reserves generation quota once and accepts stable candidate IDs only once across new request IDs', async () => {
    const s = await login(),
      ids = await setup(s),
      { job, payload } = await generate(s, ids.deckId);
    expect(
      (
        await app.inject({ method: 'POST', url: '/v1/generations', headers: headers(s), payload })
      ).json().id,
    ).toBe(job.id);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/generations',
          headers: headers(s),
          payload: { ...payload, operationId: randomUUID() },
        })
      ).statusCode,
    ).toBe(429);
    expect(await runGeneration(db, provider(), job.id)).toBe('completed');
    const generated = (
      await app.inject({ url: '/v1/generations/' + job.id, headers: headers(s) })
    ).json();
    const acceptance = {
      operationId: randomUUID(),
      candidateIds: generated.candidates.map((c: { id: string }) => c.id),
    };
    const first = (
      await app.inject({
        method: 'POST',
        url: `/v1/generations/${job.id}/accept`,
        headers: headers(s),
        payload: acceptance,
      })
    ).json();
    expect(first.cards.map((c: { id: string }) => c.id)).toEqual(acceptance.candidateIds);
    const again = (
      await app.inject({
        method: 'POST',
        url: `/v1/generations/${job.id}/accept`,
        headers: headers(s),
        payload: { ...acceptance, operationId: randomUUID() },
      })
    ).json();
    expect(again.cards).toHaveLength(2);
    expect(again.revision).toBe(first.revision);
    expect((await db.query('SELECT count(*)::int n FROM recollect.cards')).rows[0].n).toBe(3);
  });
  it('does not publish stale worker results after cancellation or lease takeover', async () => {
    const s = await login(),
      ids = await setup(s),
      { job } = await generate(s, ids.deckId, 1);
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const pending = new Promise<void>((r) => {
      release = r;
    });
    const slow: GenerationProvider = {
      generate: async (input) => {
        entered();
        await pending;
        return provider('Stale').generate(input);
      },
    };
    const old = runGeneration(db, slow, job.id);
    await started;
    await db.query(
      "UPDATE recollect.generation_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
      [job.id],
    );
    expect(await runGeneration(db, provider('Current'), job.id)).toBe('completed');
    release();
    expect(await old).toBe('ignored');
    expect(
      (await app.inject({ url: '/v1/generations/' + job.id, headers: headers(s) })).json()
        .candidates[0].front,
    ).toBe('Current');
    const second = await generate(s, ids.deckId, 1);
    await app.inject({
      method: 'DELETE',
      url: '/v1/generations/' + second.job.id,
      headers: headers(s),
    });
    expect(await runGeneration(db, provider(), second.job.id)).toBe('ignored');
  });
  it('reports real generation failure without storing mock content', async () => {
    const s = await login(),
      ids = await setup(s),
      { job } = await generate(s, ids.deckId, 1);
    const failing: GenerationProvider = {
      generate: async () => {
        throw new ProviderError('provider_rejected', 'No content', false);
      },
    };
    expect(await runGeneration(db, failing, job.id)).toBe('failed');
    const result = (
      await app.inject({ url: '/v1/generations/' + job.id, headers: headers(s) })
    ).json();
    expect(result.status).toBe('failed');
    expect(result.candidates).toEqual([]);
    expect(result.error.code).toBe('provider_rejected');
  });
  it('retains dispatch intent after queue failure and enforces persisted retry backoff', async () => {
    const s = await login(),
      ids = await setup(s),
      { job } = await generate(s, ids.deckId, 1);
    await expect(
      dispatchPending(db, async () => {
        throw new Error('Temporary queue failure');
      }),
    ).rejects.toThrow('Temporary queue failure');
    expect(
      (await db.query('SELECT dispatched_at FROM recollect.generation_jobs WHERE id=$1', [job.id]))
        .rows[0].dispatched_at,
    ).toBeNull();
    expect(await dispatchPending(db, async () => randomUUID())).toBe(1);
    await db.query(
      "UPDATE recollect.generation_jobs SET dispatched_at=now()-interval '11 minutes' WHERE id=$1",
      [job.id],
    );
    expect(await recoverAbandonedJobs(db)).toBe(1);
    expect(await dispatchPending(db, async () => randomUUID())).toBe(1);
    let attempts = 0;
    const retrying: GenerationProvider = {
      generate: async () => {
        attempts++;
        throw new ProviderError('provider_busy', 'Try later', true);
      },
    };
    expect(await runGeneration(db, retrying, job.id)).toBe('retry');
    expect(await runGeneration(db, retrying, job.id)).toBe('ignored');
    expect(attempts).toBe(1);
    expect(await dispatchPending(db, async () => randomUUID())).toBe(0);
    await db.query(
      "UPDATE recollect.generation_jobs SET available_at=now()-interval '1 second' WHERE id=$1",
      [job.id],
    );
    expect(await runGeneration(db, provider(), job.id)).toBe('completed');
  });
});
