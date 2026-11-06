import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  ALGORITHM_VERSION,
  defaultReviewSettingsInput,
  legacyPullResponseSchema,
  legacySnapshotSchema,
  pullResponseSchema,
  pushResponseSchema,
  sessionSchema,
  snapshotSchema,
  type ReviewEvent,
  type ReviewSettingsInput,
  type Session,
  type SyncOperation,
} from '@recollect/contracts';
import { initialSchedule, replayReviews } from '@recollect/scheduler';
import { createDatabase, secretHash, type Database } from '@recollect/db';
import { migrate } from '@recollect/db/migrate';
import { buildApp } from '../src/app.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('category review settings sync', () => {
  let db: Database, app: FastifyInstance;
  const deviceId = randomUUID();
  const createdAt = new Date(Date.now() - 86_400_000).toISOString();
  beforeAll(async () => {
    db = createDatabase(process.env.TEST_DATABASE_URL!);
    await db.query('DROP SCHEMA IF EXISTS recollect CASCADE');
    await migrate(db);
    app = await buildApp({
      db,
      config: {
        databaseUrl: process.env.TEST_DATABASE_URL!,
        accessSecret: 'review-settings-test-only-strong-signing-key',
        appleAudience: 'test.recollect',
        production: false,
        enableDevAuth: false,
        accessTtlSeconds: 900,
        refreshTtlSeconds: 86_400,
        dailyGenerationCards: 100,
      },
      appleVerifier: async (token) => JSON.parse(token),
    });
  });
  beforeEach(async () => {
    await db.query(
      'TRUNCATE recollect.users,recollect.auth_challenges,recollect.rate_buckets CASCADE',
    );
  });
  afterAll(async () => {
    await app?.close();
    await db?.end();
  });
  const headers = (session: Session) => ({
    authorization: 'Bearer ' + session.accessToken,
    'x-recollect-scheduler': ALGORITHM_VERSION,
    'x-recollect-deck-images': '1',
  });
  async function login(): Promise<Session> {
    const challenge = (
      await app.inject({ method: 'POST', url: '/v1/auth/apple/challenge' })
    ).json();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/apple',
      payload: {
        challengeId: challenge.challengeId,
        identityToken: JSON.stringify({ sub: randomUUID(), nonce: secretHash(challenge.nonce) }),
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    return sessionSchema.parse(response.json());
  }
  async function push(session: Session, ...operations: SyncOperation[]) {
    const response = await app.inject({
      method: 'POST',
      url: '/v2/sync/push',
      headers: headers(session),
      payload: { operations },
    });
    expect(response.statusCode, response.body).toBe(200);
    return pushResponseSchema.parse(response.json());
  }
  async function snapshot(session: Session) {
    const response = await app.inject({ url: '/v2/sync/snapshot', headers: headers(session) });
    expect(response.statusCode, response.body).toBe(200);
    return snapshotSchema.parse(response.json());
  }
  const settingsOp = (
    payload: ReviewSettingsInput,
    baseVersion = 0,
  ): Extract<SyncOperation, { type: 'reviewSettings.upsert' }> => ({
    operationId: randomUUID(),
    deviceId,
    createdAt,
    type: 'reviewSettings.upsert',
    baseVersion,
    payload,
  });
  async function library(session: Session) {
    const deckId = randomUUID(),
      cardId = randomUUID();
    const response = await push(
      session,
      {
        operationId: randomUUID(),
        deviceId,
        createdAt,
        type: 'deck.upsert',
        baseVersion: 0,
        payload: {
          id: deckId,
          name: 'Trivia',
          description: '',
          color: '#2441EA',
          icon: '📚',
          isSilenced: false,
          silencedUntil: null,
        },
      },
      {
        operationId: randomUUID(),
        deviceId,
        createdAt,
        type: 'card.upsert',
        baseVersion: 0,
        payload: {
          id: cardId,
          deckId,
          front: 'Alternator',
          back: 'Charges the battery',
          hint: '',
          explanation: '',
          tags: [],
          aiGenerated: false,
        },
      },
    );
    expect(response.receipts.map((receipt) => receipt.status)).toEqual(['accepted', 'accepted']);
    return { deckId, cardId };
  }
  function assigned(ownerId: string, deckId: string): ReviewSettingsInput {
    const categoryId = randomUUID();
    return {
      ...defaultReviewSettingsInput(ownerId),
      categories: [
        { id: categoryId, name: 'Jeopardy', color: '#2441EA', reviewEnabled: true, cadence: null },
      ],
      deckCategories: { [deckId]: categoryId },
    };
  }
  const review = (
    deckId: string,
    cardId: string,
    sequence: number,
    cadence?: ReviewEvent['cadence'],
  ): ReviewEvent => ({
    id: randomUUID(),
    deckId,
    cardId,
    deviceId,
    deviceSequence: sequence,
    rating: 'good',
    reviewedAt: new Date(Date.parse(createdAt) + sequence * 60_000).toISOString(),
    elapsedMs: 1000,
    algorithmVersion: ALGORITHM_VERSION,
    ...(cadence ? { cadence } : {}),
  });
  const reviewOp = (payload: ReviewEvent): SyncOperation => ({
    operationId: randomUUID(),
    deviceId,
    createdAt,
    type: 'review.append',
    payload,
  });

  it('isolates settings and rejects foreign settings identities and missing/foreign deck assignments', async () => {
    const owner = await login(),
      other = await login();
    expect((await snapshot(owner)).reviewSettings).toBeNull();
    const { deckId } = await library(owner);
    const input = assigned(owner.user.id, deckId);
    expect((await push(owner, settingsOp(input))).receipts[0]!.status).toBe('accepted');
    expect((await snapshot(owner)).reviewSettings?.categories[0]!.name).toBe('Jeopardy');
    expect((await snapshot(other)).reviewSettings).toBeNull();
    expect((await push(other, settingsOp(input))).receipts[0]!.error?.code).toBe('invalid_owner');
    expect(
      (await push(other, settingsOp({ ...input, id: other.user.id }))).receipts[0]!.error?.code,
    ).toBe('not_found');
    expect(
      (await push(other, settingsOp(assigned(other.user.id, randomUUID())))).receipts[0]!.error
        ?.code,
    ).toBe('not_found');
    expect((await snapshot(other)).reviewSettings).toBeNull();
  });

  it('persists durable retries and returns a canonical optimistic conflict without overwriting newer preferences', async () => {
    const owner = await login(),
      input = defaultReviewSettingsInput(owner.user.id);
    const operation = settingsOp(input);
    const first = (await push(owner, operation)).receipts[0]!;
    expect(first.status).toBe('accepted');
    const newer = settingsOp({ ...input, reviewEnabled: false }, 1);
    expect((await push(owner, newer)).receipts[0]!.status).toBe('accepted');
    const raced = await Promise.all([
      push(owner, settingsOp({ ...input, reviewEnabled: false }, 2)),
      push(
        owner,
        settingsOp(
          {
            ...input,
            reviewEnabled: false,
            cadence: { ...input.cadence, goodDays: 10 },
          },
          2,
        ),
      ),
    ]);
    expect(raced.map((result) => result.receipts[0]!.status).sort()).toEqual([
      'accepted',
      'conflict',
    ]);
    expect((await snapshot(owner)).reviewSettings?.version).toBe(3);
    expect((await push(owner, operation)).receipts[0]).toEqual({ ...first, status: 'duplicate' });
    const stale = (await push(owner, settingsOp(input, 1))).receipts[0]!;
    expect(stale.status).toBe('conflict');
    expect(stale.canonical?.entity).toBe('reviewSettings');
    expect((await snapshot(owner)).reviewSettings?.reviewEnabled).toBe(false);
    expect(
      (await push(owner, { ...operation, payload: { ...input, reviewEnabled: false } }))
        .receipts[0]!.error?.code,
    ).toBe('operation_id_reused');
    expect(
      (await db.query('SELECT count(*)::int AS count FROM recollect.review_settings')).rows[0]
        .count,
    ).toBe(1);
  });

  it('removes categories without deleting decks, cards, histories, or current due dates', async () => {
    const owner = await login(),
      { deckId, cardId } = await library(owner);
    const input = assigned(owner.user.id, deckId);
    await push(owner, settingsOp(input), reviewOp(review(deckId, cardId, 1)));
    const before = await snapshot(owner);
    const changed = { ...input, categories: [], deckCategories: {} };
    expect((await push(owner, settingsOp(changed, 1))).receipts[0]!.status).toBe('accepted');
    const after = await snapshot(owner);
    expect(after.reviewSettings?.categories).toEqual([]);
    expect(after.decks).toEqual(before.decks);
    expect(after.cards).toEqual(before.cards);
    expect(after.reviews).toEqual(before.reviews);
  });

  it('accepts an offline deck deletion followed by a captured settings edit and prunes the tombstoned assignment', async () => {
    const owner = await login(),
      { deckId } = await library(owner);
    const input = assigned(owner.user.id, deckId);
    await push(owner, settingsOp(input));
    // Both commands are prepared from settings version 1 before either syncs.
    const queuedSettingsEdit = settingsOp(
      {
        ...input,
        categories: input.categories.map((category) => ({ ...category, name: 'Jeopardy trivia' })),
      },
      1,
    );
    const result = await push(
      owner,
      {
        operationId: randomUUID(),
        deviceId,
        createdAt,
        type: 'deck.delete',
        baseVersion: 1,
        payload: { id: deckId },
      },
      queuedSettingsEdit,
    );
    expect(result.receipts.map((receipt) => receipt.status)).toEqual(['accepted', 'accepted']);
    const deleted = await snapshot(owner);
    expect(deleted.reviewSettings?.deckCategories).toEqual({});
    expect(deleted.reviewSettings?.version).toBe(2);
    expect(deleted.reviewSettings?.categories[0]!.name).toBe('Jeopardy trivia');
    const retry = (await push(owner, queuedSettingsEdit)).receipts[0]!;
    expect(retry).toEqual({ ...result.receipts[1], status: 'duplicate' });
    expect((await snapshot(owner)).reviewSettings?.version).toBe(2);
    const changes = pullResponseSchema.parse(
      (
        await app.inject({
          url: '/v2/sync/pull?cursor=3&limit=1',
          headers: headers(owner),
        })
      ).json(),
    ).changes;
    expect(changes.map((change) => change.entity)).toEqual(['deck', 'card']);
    const oldPage = legacyPullResponseSchema.parse(
      (
        await app.inject({
          url: '/v1/sync/pull?cursor=3&until=4&limit=1',
          headers: headers(owner),
        })
      ).json(),
    );
    expect(oldPage).toMatchObject({ cursor: '4', highWatermark: '4', hasMore: false });
    expect(oldPage.changes.map((change) => change.entity)).toEqual(['deck', 'card']);
  });

  it('replays captured default and custom cadences in chronological order without retroactive rescheduling', async () => {
    const owner = await login(),
      { deckId, cardId } = await library(owner);
    const input = assigned(owner.user.id, deckId);
    const custom = { ...input.cadence, goodDays: 21, easyDays: 30, growIntervals: false };
    input.categories[0]!.cadence = custom;
    await push(owner, settingsOp(input));
    const first = review(deckId, cardId, 1, input.cadence);
    const second = review(deckId, cardId, 2, custom);
    await push(owner, reviewOp(second), reviewOp(first));
    const before = await snapshot(owner);
    expect(before.reviews).toEqual([first, second]);
    expect(before.cards[0]!.schedule).toEqual(
      replayReviews(initialSchedule(createdAt), [first, second]),
    );
    expect(before.cards[0]!.schedule.intervalSeconds).toBe(21 * 86_400);
    await push(
      owner,
      settingsOp({ ...input, cadence: { ...input.cadence, goodDays: 10, easyDays: 14 } }, 1),
    );
    expect((await snapshot(owner)).cards).toEqual(before.cards);
    expect(
      (await push(owner, reviewOp({ ...second, cadence: input.cadence }))).receipts[0]!.error?.code,
    ).toBe('event_id_reused');
  });

  it('lets v1 clients cross settings-only revisions and exposes strict old snapshot/review shapes', async () => {
    const owner = await login(),
      { deckId, cardId } = await library(owner);
    const input = assigned(owner.user.id, deckId);
    await push(owner, settingsOp(input));
    const firstPage = await app.inject({
      url: '/v1/sync/pull?cursor=2&limit=1',
      headers: headers(owner),
    });
    expect(legacyPullResponseSchema.parse(firstPage.json())).toEqual({
      cursor: '3',
      highWatermark: '3',
      hasMore: false,
      changes: [],
    });
    const event = review(deckId, cardId, 1, input.cadence);
    await push(owner, reviewOp(event));
    const secondPage = legacyPullResponseSchema.parse(
      (
        await app.inject({
          url: '/v1/sync/pull?cursor=2&limit=1',
          headers: headers(owner),
        })
      ).json(),
    );
    expect(secondPage).toMatchObject({
      cursor: '3',
      highWatermark: '4',
      hasMore: true,
      changes: [],
    });
    const thirdPage = legacyPullResponseSchema.parse(
      (
        await app.inject({
          url: '/v1/sync/pull?cursor=3&until=4&limit=1',
          headers: headers(owner),
        })
      ).json(),
    );
    expect(thirdPage.cursor).toBe('4');
    expect(thirdPage.changes).toHaveLength(2);
    const reviewChange = thirdPage.changes.find((change) => change.entity === 'review');
    expect(reviewChange?.data).not.toHaveProperty('cadence');
    for (const url of ['/v1/snapshot', '/v1/sync/snapshot']) {
      const old = legacySnapshotSchema.parse(
        (await app.inject({ url, headers: headers(owner) })).json(),
      );
      expect(old).not.toHaveProperty('reviewSettings');
      expect(old.reviews[0]).not.toHaveProperty('cadence');
      expect(old.cards[0]!.schedule).toEqual((await snapshot(owner)).cards[0]!.schedule);
    }
    for (const operation of [settingsOp(input, 1), reviewOp(event)]) {
      const rejected = await app.inject({
        method: 'POST',
        url: '/v1/sync/push',
        headers: headers(owner),
        payload: { operations: [operation] },
      });
      expect(rejected.statusCode, rejected.body).toBe(400);
    }
  });

  it('leaves cadence-free v1 reviews on their declared scheduler and filters due counts by category/global preferences', async () => {
    const owner = await login(),
      { deckId, cardId } = await library(owner);
    const input = assigned(owner.user.id, deckId);
    input.cadence = { ...input.cadence, goodDays: 21, easyDays: 30 };
    await push(owner, settingsOp(input));
    const legacyEvent: ReviewEvent = { ...review(deckId, cardId, 1), algorithmVersion: 'sm2-v1' };
    const response = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: headers(owner),
      payload: { operations: [reviewOp(legacyEvent)] },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect((await snapshot(owner)).cards[0]!.schedule).toEqual(
      replayReviews(initialSchedule(createdAt), [legacyEvent]),
    );
    expect(
      (await app.inject({ url: '/v1/progress', headers: headers(owner) })).json().dueCards,
    ).toBe(1);
    input.categories[0]!.reviewEnabled = false;
    await push(owner, settingsOp(input, 1));
    expect(
      (await app.inject({ url: '/v1/progress', headers: headers(owner) })).json().dueCards,
    ).toBe(0);
    await push(
      owner,
      settingsOp({ ...input, reviewEnabled: false, categories: [], deckCategories: {} }, 2),
    );
    expect(
      (await app.inject({ url: '/v1/progress', headers: headers(owner) })).json().dueCards,
    ).toBe(0);
  });

  it('cascades private preferences when an account is erased', async () => {
    const owner = randomUUID();
    const now = new Date().toISOString();
    await db.query("INSERT INTO recollect.users(id,name) VALUES($1,'Erase me')", [owner]);
    await db.query('INSERT INTO recollect.review_settings(owner_id,data) VALUES($1,$2)', [
      owner,
      {
        ...defaultReviewSettingsInput(owner),
        ownerId: owner,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ]);
    await db.query('DELETE FROM recollect.users WHERE id=$1', [owner]);
    expect(
      (await db.query('SELECT 1 FROM recollect.review_settings WHERE owner_id=$1', [owner]))
        .rowCount,
    ).toBe(0);
  });
});
