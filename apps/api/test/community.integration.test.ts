import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  ALGORITHM_VERSION,
  cardInput,
  communityOverviewSchema,
  deckInput,
  deckShareSchema,
  friendInviteSchema,
  pullResponseSchema,
  recallInsightsSchema,
  sessionSchema,
  shareDetailSchema,
  snapshotSchema,
  type Card,
  type Deck,
  type ReviewEvent,
  type Session,
  type SyncOperation,
} from '@recollect/contracts';
import {
  appendChanges,
  createDatabase,
  lockOwner,
  secretHash,
  transaction,
  type Database,
} from '@recollect/db';
import { migrate } from '@recollect/db/migrate';
import { buildApp } from '../src/app.js';
import type { ApiConfig } from '../src/config.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('private community and recall insights', () => {
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
  const deviceId = randomUUID();
  const createdAt = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const sequence = new Map<string, number>();
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
    sequence.clear();
  });
  afterAll(async () => {
    await app?.close();
    await db?.end();
  });
  const headers = (session: Session) => ({
    authorization: 'Bearer ' + session.accessToken,
    'x-recollect-scheduler': ALGORITHM_VERSION,
  });
  async function login(name = 'Learner'): Promise<Session> {
    const subject = randomUUID();
    const challenge = (
      await app.inject({ method: 'POST', url: '/v1/auth/apple/challenge' })
    ).json();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/apple',
      payload: {
        challengeId: challenge.challengeId,
        identityToken: JSON.stringify({
          sub: subject,
          nonce: secretHash(challenge.nonce),
          email: subject + '@example.test',
        }),
        displayName: name,
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    return sessionSchema.parse(response.json());
  }
  async function push(session: Session, ...operations: SyncOperation[]) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: headers(session),
      payload: { operations },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(
      response
        .json()
        .receipts.every((receipt: { status: string }) => receipt.status === 'accepted'),
    ).toBe(true);
    return response.json();
  }
  async function library(session: Session, name = 'Italian', count = 2) {
    const deckId = randomUUID();
    const operations: SyncOperation[] = [
      {
        type: 'deck.upsert',
        operationId: randomUUID(),
        deviceId,
        createdAt,
        baseVersion: 0,
        payload: {
          id: deckId,
          name,
          description: 'Everyday vocabulary',
          color: '#2441EA',
          icon: '✈️',
          isSilenced: false,
          silencedUntil: null,
        },
      },
    ];
    const cardIds: string[] = [];
    for (let index = 0; index < count; index++) {
      const id = randomUUID();
      cardIds.push(id);
      operations.push({
        type: 'card.upsert',
        operationId: randomUUID(),
        deviceId,
        createdAt,
        baseVersion: 0,
        payload: {
          id,
          deckId,
          front: ['Ciao', 'Grazie'][index] ?? 'Card ' + index,
          back: ['Hello', 'Thank you'][index] ?? 'Answer ' + index,
          hint: '',
          explanation: '',
          tags: ['Italian'],
          aiGenerated: false,
        },
      });
    }
    await push(session, ...operations);
    return { deckId, cardIds };
  }
  async function review(
    session: Session,
    deckId: string,
    cardId: string,
    rating: ReviewEvent['rating'],
    daysAgo = 0,
  ) {
    const seq = (sequence.get(session.user.id) ?? 0) + 1;
    sequence.set(session.user.id, seq);
    const event: ReviewEvent = {
      id: randomUUID(),
      cardId,
      deckId,
      deviceId,
      deviceSequence: seq,
      rating,
      reviewedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
      elapsedMs: 2000,
      algorithmVersion: ALGORITHM_VERSION,
    };
    await push(session, {
      type: 'review.append',
      operationId: randomUUID(),
      deviceId,
      createdAt: new Date().toISOString(),
      payload: event,
    });
    return event;
  }
  async function invite(session: Session) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/community/invites',
      headers: headers(session),
    });
    expect(response.statusCode, response.body).toBe(200);
    return friendInviteSchema.parse(response.json());
  }
  async function connect(sender: Session, recipient: Session) {
    const code = (await invite(sender)).code;
    const response = await app.inject({
      method: 'POST',
      url: '/v1/community/invites/accept',
      headers: headers(recipient),
      payload: { code },
    });
    expect(response.statusCode, response.body).toBe(200);
    return communityOverviewSchema.parse(response.json());
  }
  async function share(sender: Session, recipient: Session, deckId: string, shareProgress = false) {
    const payload = {
      operationId: randomUUID(),
      friendId: recipient.user.id,
      deckId,
      shareProgress,
    };
    const response = await app.inject({
      method: 'POST',
      url: '/v1/community/shares',
      headers: headers(sender),
      payload,
    });
    expect(response.statusCode, response.body).toBe(200);
    return { ...deckShareSchema.parse(response.json()), request: payload };
  }
  async function accept(recipient: Session, id: string, shareProgress = false) {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/community/shares/${id}/accept`,
      headers: headers(recipient),
      payload: { shareProgress },
    });
    expect(response.statusCode, response.body).toBe(200);
    return deckShareSchema.parse(response.json());
  }
  async function snapshot(session: Session) {
    const response = await app.inject({ url: '/v1/snapshot', headers: headers(session) });
    expect(response.statusCode, response.body).toBe(200);
    return snapshotSchema.parse(response.json());
  }
  async function insights(
    caller: Session,
    shareId: string,
    target: Session,
    query = 'days=all&timezone=UTC',
  ) {
    return app.inject({
      url: `/v1/community/shares/${shareId}/insights/${target.user.id}?${query}`,
      headers: headers(caller),
    });
  }
  async function editCard(session: Session, card: Card, front: string) {
    await push(session, {
      type: 'card.upsert',
      operationId: randomUUID(),
      deviceId,
      createdAt: new Date().toISOString(),
      baseVersion: card.version,
      payload: { ...cardInput(card), front },
    });
    return (await snapshot(session)).cards.find((item) => item.id === card.id)!;
  }

  it('requires authentication and stores only hashed, expiring, single-use invitation secrets', async () => {
    expect((await app.inject({ url: '/v1/community' })).statusCode).toBe(401);
    const sender = await login('Alex'),
      recipient = await login('Sam'),
      stranger = await login('Other');
    const token = await invite(sender);
    expect(token.code).toHaveLength(32);
    const stored = (await db.query('SELECT * FROM recollect.friend_invites')).rows[0];
    expect(stored.code_hash).toBe(secretHash(token.code));
    expect(JSON.stringify(stored)).not.toContain(token.code);
    const acceptCode = (person: Session) =>
      app.inject({
        method: 'POST',
        url: '/v1/community/invites/accept',
        headers: headers(person),
        payload: { code: token.code },
      });
    expect((await acceptCode(sender)).statusCode).toBe(400);
    const connected = await acceptCode(recipient);
    expect(connected.statusCode, connected.body).toBe(200);
    const result = communityOverviewSchema.parse(connected.json());
    expect(result.friends.map((friend) => friend.id)).toEqual([sender.user.id]);
    expect(JSON.stringify(result)).not.toContain('@example.test');
    expect((await acceptCode(recipient)).statusCode).toBe(200);
    expect((await acceptCode(stranger)).statusCode).toBe(409);
    const expired = await invite(sender);
    await db.query(
      "UPDATE recollect.friend_invites SET expires_at=now()-interval '1 second' WHERE code_hash=$1",
      [secretHash(expired.code)],
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/community/invites/accept',
          headers: headers(stranger),
          payload: { code: expired.code },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('allows only one recipient to consume an invitation even during simultaneous acceptance', async () => {
    const sender = await login(),
      a = await login(),
      b = await login();
    const { code } = await invite(sender);
    const responses = await Promise.all(
      [a, b].map((person) =>
        app.inject({
          method: 'POST',
          url: '/v1/community/invites/accept',
          headers: headers(person),
          payload: { code },
        }),
      ),
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(
      (await db.query('SELECT count(*)::int AS n FROM recollect.friendships WHERE active=true'))
        .rows[0].n,
    ).toBe(1);
  });

  it('shares only an owned active deck with a friend and never exposes private library or email', async () => {
    const sender = await login(),
      recipient = await login(),
      stranger = await login();
    const publicDeck = await library(sender),
      privateDeck = await library(sender, 'Private journal');
    const payload = {
      operationId: randomUUID(),
      friendId: recipient.user.id,
      deckId: publicDeck.deckId,
      shareProgress: false,
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/community/shares',
          headers: headers(sender),
          payload,
        })
      ).statusCode,
    ).toBe(404);
    await connect(sender, recipient);
    const offered = await share(sender, recipient, publicDeck.deckId);
    expect(offered.senderSharesProgress).toBe(false);
    expect(offered.recipientSharesProgress).toBe(false);
    const detail = await app.inject({
      url: `/v1/community/shares/${offered.id}`,
      headers: headers(recipient),
    });
    expect(
      shareDetailSchema
        .parse(detail.json())
        .cards.map((card) => card.id)
        .sort(),
    ).toEqual(publicDeck.cardIds.sort());
    expect(detail.body).not.toContain(privateDeck.deckId);
    expect(detail.body).not.toContain(sender.user.email!);
    expect(
      (await app.inject({ url: `/v1/community/shares/${offered.id}`, headers: headers(stranger) }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/community/shares',
          headers: headers(recipient),
          payload: { ...payload, operationId: randomUUID(), friendId: sender.user.id },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('snapshots content, copies fresh identities and schedules, publishes sync changes, and retries acceptance once', async () => {
    const sender = await login(),
      recipient = await login();
    await connect(sender, recipient);
    const original = await library(sender);
    await review(sender, original.deckId, original.cardIds[0]!, 'good', 1);
    const offered = await share(sender, recipient, original.deckId, true);
    let source = (await snapshot(sender)).cards.find((card) => card.id === original.cardIds[0])!;
    source = await editCard(sender, source, 'Changed after sharing');
    const before = await snapshot(recipient);
    const imported = await accept(recipient, offered.id);
    expect(imported.recipientDeckId).not.toBe(original.deckId);
    const result = await snapshot(recipient);
    expect(result.cards).toHaveLength(2);
    expect(
      result.cards.every(
        (card) =>
          !original.cardIds.includes(card.id) &&
          card.ownerId === recipient.user.id &&
          card.schedule.totalReviews === 0 &&
          card.schedule.phase === 'new',
      ),
    ).toBe(true);
    expect(result.cards.some((card) => card.front === 'Changed after sharing')).toBe(false);
    const pull = await app.inject({
      url: '/v1/sync/pull?cursor=' + before.cursor,
      headers: headers(recipient),
    });
    const changes = pullResponseSchema.parse(pull.json()).changes;
    expect(changes.filter((change) => change.entity === 'deck')).toHaveLength(1);
    expect(changes.filter((change) => change.entity === 'card')).toHaveLength(2);
    const retries = await Promise.all([
      accept(recipient, offered.id, true),
      accept(recipient, offered.id, true),
    ]);
    expect(
      retries.every(
        (retry) =>
          retry.recipientDeckId === imported.recipientDeckId &&
          retry.recipientSharesProgress === false,
      ),
    ).toBe(true);
    expect((await snapshot(recipient)).cursor).toBe(result.cursor);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/community/shares/${offered.id}/accept`,
          headers: headers(sender),
          payload: { shareProgress: true },
        })
      ).statusCode,
    ).toBe(404);
    const retried = await app.inject({
      method: 'POST',
      url: '/v1/community/shares',
      headers: headers(sender),
      payload: offered.request,
    });
    expect(retried.json().id).toBe(offered.id);
    const reused = await app.inject({
      method: 'POST',
      url: '/v1/community/shares',
      headers: headers(sender),
      payload: { ...offered.request, shareProgress: false },
    });
    expect(reused.statusCode).toBe(409);
    expect((await snapshot(sender)).cards.find((card) => card.id === source.id)?.front).toBe(
      source.front,
    );
  });

  it('keeps detailed history private until each participant explicitly grants it, with immediate revocation', async () => {
    const sender = await login(),
      recipient = await login(),
      stranger = await login();
    await connect(sender, recipient);
    await connect(sender, stranger);
    const original = await library(sender),
      secret = await library(sender, 'Secret topic');
    await review(sender, original.deckId, original.cardIds[0]!, 'again', 4);
    await review(sender, original.deckId, original.cardIds[0]!, 'again', 3);
    await review(sender, original.deckId, original.cardIds[1]!, 'good', 2);
    await review(sender, secret.deckId, secret.cardIds[0]!, 'easy', 1);
    const offered = await share(sender, recipient, original.deckId);
    expect((await insights(recipient, offered.id, sender)).statusCode).toBe(404);
    const imported = await accept(recipient, offered.id);
    expect((await insights(recipient, offered.id, sender)).statusCode).toBe(403);
    expect((await insights(sender, offered.id, sender)).statusCode).toBe(200);
    const grant = await app.inject({
      method: 'PATCH',
      url: `/v1/community/shares/${offered.id}/progress`,
      headers: headers(sender),
      payload: { enabled: true },
    });
    expect(grant.statusCode, grant.body).toBe(200);
    const history = recallInsightsSchema.parse(
      (await insights(recipient, offered.id, sender)).json(),
    );
    expect(history.summary.reviewCount).toBe(3);
    expect(history.cards.find((card) => card.id === original.cardIds[0])?.repeatUnsure).toBe(true);
    expect(JSON.stringify(history)).not.toContain(secret.deckId);
    expect((await insights(stranger, offered.id, sender)).statusCode).toBe(404);
    expect((await insights(recipient, offered.id, stranger)).statusCode).toBe(404);
    const ownCopy = (await snapshot(recipient)).cards.find(
      (card) => card.deckId === imported.recipientDeckId,
    )!;
    await review(recipient, ownCopy.deckId, ownCopy.id, 'good');
    expect((await insights(sender, offered.id, recipient)).statusCode).toBe(403);
    await app.inject({
      method: 'PATCH',
      url: `/v1/community/shares/${offered.id}/progress`,
      headers: headers(recipient),
      payload: { enabled: true },
    });
    const recipientHistory = recallInsightsSchema.parse(
      (await insights(sender, offered.id, recipient)).json(),
    );
    expect(recipientHistory.summary.reviewCount).toBe(1);
    expect(recipientHistory.cards.map((card) => card.id)).toContain(ownCopy.id);
    expect(recipientHistory.cards.map((card) => card.id)).not.toContain(original.cardIds[0]);
    await app.inject({
      method: 'PATCH',
      url: `/v1/community/shares/${offered.id}/progress`,
      headers: headers(sender),
      payload: { enabled: false },
    });
    expect((await insights(recipient, offered.id, sender)).statusCode).toBe(403);
    expect((await insights(sender, offered.id, recipient)).statusCode).toBe(200);
  });

  it('excludes materially edited shared cards even after reverting and never includes post-share additions', async () => {
    const sender = await login(),
      recipient = await login();
    await connect(sender, recipient);
    const original = await library(sender);
    await review(sender, original.deckId, original.cardIds[0]!, 'again', 2);
    await review(sender, original.deckId, original.cardIds[1]!, 'good', 1);
    const offered = await share(sender, recipient, original.deckId, true);
    await accept(recipient, offered.id, true);
    const addedId = randomUUID();
    const originalCard = (await snapshot(sender)).cards.find(
      (card) => card.id === original.cardIds[0],
    )!;
    await push(sender, {
      type: 'card.upsert',
      operationId: randomUUID(),
      deviceId,
      createdAt,
      baseVersion: 0,
      payload: { ...cardInput(originalCard), id: addedId, front: 'Private card added later' },
    });
    const changed = await editCard(sender, originalCard, 'Unrelated private question');
    await editCard(sender, changed, originalCard.front);
    const source = recallInsightsSchema.parse(
      (await insights(recipient, offered.id, sender)).json(),
    );
    expect(source.excludedEditedCardCount).toBe(1);
    expect(source.cards.map((card) => card.id)).toEqual([original.cardIds[1]]);
    expect(source.summary.reviewCount).toBe(1);
    expect(JSON.stringify(source)).not.toContain('Private card added later');
    const own = await app.inject({
      url: '/v1/insights?days=all&timezone=UTC',
      headers: headers(sender),
    });
    expect(recallInsightsSchema.parse(own.json()).summary.reviewCount).toBe(2);
    const copy = (await snapshot(recipient)).cards[0]!;
    await editCard(recipient, copy, 'My private replacement');
    const copied = recallInsightsSchema.parse(
      (await insights(sender, offered.id, recipient)).json(),
    );
    expect(copied.excludedEditedCardCount).toBe(1);
    expect(JSON.stringify(copied)).not.toContain('My private replacement');
    expect(copied.cards).toHaveLength(1);
  });

  it('uses shared deck titles and excludes moved cards, including moves subsequently reverted', async () => {
    const sender = await login(),
      recipient = await login();
    await connect(sender, recipient);
    const original = await library(sender);
    const offered = await share(sender, recipient, original.deckId);
    const imported = await accept(recipient, offered.id, true);
    const recipientLibrary = await snapshot(recipient);
    const copiedDeck = recipientLibrary.decks.find((deck) => deck.id === imported.recipientDeckId)!;
    await push(recipient, {
      type: 'deck.upsert',
      operationId: randomUUID(),
      deviceId,
      createdAt: new Date().toISOString(),
      baseVersion: copiedDeck.version,
      payload: { ...deckInput(copiedDeck), name: 'Private personal collection title' },
    });
    const renamed = recallInsightsSchema.parse(
      (await insights(sender, offered.id, recipient)).json(),
    );
    expect(renamed.cards.every((card) => card.deckName === 'Italian')).toBe(true);
    expect(JSON.stringify(renamed)).not.toContain('Private personal collection title');
    const secretDeck = await library(recipient, 'Confidential deck');
    const copy = recipientLibrary.cards[0]!;
    // Moving is currently disallowed by sync. Simulate a future storage command
    // to prove a mapping cannot confer access to a different deck's history.
    async function move(deckId: string) {
      await transaction(db, async (tx) => {
        await lockOwner(tx, recipient.user.id);
        const moved = { ...copy, deckId };
        await tx.query(
          'UPDATE recollect.cards SET deck_id=$3,data=$4 WHERE owner_id=$1 AND id=$2',
          [recipient.user.id, copy.id, deckId, moved],
        );
        await appendChanges(tx, recipient.user.id, [{ entity: 'card', data: moved }]);
      });
    }
    await move(secretDeck.deckId);
    const moved = recallInsightsSchema.parse(
      (await insights(sender, offered.id, recipient)).json(),
    );
    expect(moved.excludedEditedCardCount).toBe(1);
    expect(JSON.stringify(moved)).not.toContain(secretDeck.deckId);
    expect(JSON.stringify(moved)).not.toContain('Confidential deck');
    await move(copy.deckId);
    const restored = recallInsightsSchema.parse(
      (await insights(sender, offered.id, recipient)).json(),
    );
    expect(restored.excludedEditedCardCount).toBe(1);
    expect(restored.cards.map((card) => card.id)).not.toContain(copy.id);
  });

  it('combines permitted shared decks without duplicating source cards and respects per-deck grants', async () => {
    const sender = await login(),
      recipient = await login();
    await connect(sender, recipient);
    const a = await library(sender, 'Italian'),
      b = await library(sender, 'Engineering'),
      privateDeck = await library(sender, 'Private');
    await review(sender, a.deckId, a.cardIds[0]!, 'again', 2);
    await review(sender, b.deckId, b.cardIds[0]!, 'good', 1);
    await review(sender, privateDeck.deckId, privateDeck.cardIds[0]!, 'good');
    const shares = [
      await share(sender, recipient, a.deckId, true),
      await share(sender, recipient, a.deckId, true),
      await share(sender, recipient, b.deckId, false),
    ];
    for (const item of shares) await accept(recipient, item.id);
    const get = () =>
      app.inject({
        url: `/v1/community/friends/${sender.user.id}/insights?days=all`,
        headers: headers(recipient),
      });
    const first = recallInsightsSchema.parse((await get()).json());
    expect(first.summary.cardCount).toBe(2);
    expect(first.summary.reviewCount).toBe(1);
    expect(JSON.stringify(first)).not.toContain(b.deckId);
    await app.inject({
      method: 'PATCH',
      url: `/v1/community/shares/${shares[2]!.id}/progress`,
      headers: headers(sender),
      payload: { enabled: true },
    });
    const combined = recallInsightsSchema.parse((await get()).json());
    expect(combined.summary.cardCount).toBe(4);
    expect(combined.summary.reviewCount).toBe(2);
    expect(JSON.stringify(combined)).not.toContain(privateDeck.deckId);
  });

  it('revokes both participants access on share deletion while preserving independent copied cards', async () => {
    const sender = await login(),
      recipient = await login();
    await connect(sender, recipient);
    const original = await library(sender);
    const offered = await share(sender, recipient, original.deckId, true);
    const accepted = await accept(recipient, offered.id, true);
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/v1/community/shares/${offered.id}`,
      headers: headers(recipient),
    });
    expect(deleted.statusCode).toBe(200);
    expect(communityOverviewSchema.parse(deleted.json()).shares).toEqual([]);
    expect((await insights(recipient, offered.id, sender)).statusCode).toBe(404);
    expect((await insights(sender, offered.id, recipient)).statusCode).toBe(404);
    expect(
      (await app.inject({ url: `/v1/community/shares/${offered.id}`, headers: headers(sender) }))
        .statusCode,
    ).toBe(404);
    expect((await snapshot(recipient)).decks.map((deck) => deck.id)).toContain(
      accepted.recipientDeckId,
    );
    expect((await snapshot(recipient)).cards).toHaveLength(2);
    expect((await snapshot(sender)).cards).toHaveLength(2);
  });

  it('removes friendships atomically with every share and does not revive access by reusing a consumed invite', async () => {
    const sender = await login(),
      recipient = await login();
    const token = await invite(sender);
    const acceptInvite = () =>
      app.inject({
        method: 'POST',
        url: '/v1/community/invites/accept',
        headers: headers(recipient),
        payload: { code: token.code },
      });
    await acceptInvite();
    const original = await library(sender);
    const offered = await share(sender, recipient, original.deckId, true);
    await accept(recipient, offered.id, true);
    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/community/friends/${recipient.user.id}`,
      headers: headers(sender),
    });
    expect(communityOverviewSchema.parse(removed.json())).toEqual({ friends: [], shares: [] });
    expect((await insights(recipient, offered.id, sender)).statusCode).toBe(404);
    expect((await acceptInvite()).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          url: `/v1/community/friends/${sender.user.id}/insights`,
          headers: headers(recipient),
        })
      ).statusCode,
    ).toBe(404);
    await connect(sender, recipient);
    expect(
      (await app.inject({ url: `/v1/community/shares/${offered.id}`, headers: headers(recipient) }))
        .statusCode,
    ).toBe(404);
    expect((await snapshot(recipient)).cards).toHaveLength(2);
  });

  it('filters personal insights by time, deck and card, rejects invalid timezones, and excludes other accounts and deleted cards', async () => {
    const owner = await login(),
      other = await login();
    const first = await library(owner),
      second = await library(owner, 'Engineering'),
      foreign = await library(other);
    await review(owner, first.deckId, first.cardIds[0]!, 'again', 10);
    await review(owner, first.deckId, first.cardIds[0]!, 'good', 1);
    await review(owner, second.deckId, second.cardIds[0]!, 'easy');
    await review(other, foreign.deckId, foreign.cardIds[0]!, 'again');
    const get = (query: string) =>
      app.inject({ url: '/v1/insights?' + query, headers: headers(owner) });
    const selected = recallInsightsSchema.parse(
      (await get('days=7&timezone=America%2FNew_York&deckId=' + first.deckId)).json(),
    );
    expect(selected.summary.reviewCount).toBe(1);
    expect(selected.summary.cardCount).toBe(2);
    expect(selected.window.timezone).toBe('America/New_York');
    const history = recallInsightsSchema.parse(
      (await get('days=all&cardId=' + first.cardIds[0])).json(),
    );
    expect(history.summary.reviewCount).toBe(2);
    expect(history.cards).toHaveLength(1);
    expect((await get('timezone=Not%2FAZone')).statusCode).toBe(400);
    expect((await get('days=1')).statusCode).toBe(400);
    expect(
      recallInsightsSchema.parse((await get('cardId=' + foreign.cardIds[0])).json()).cards,
    ).toEqual([]);
    const card = (await snapshot(owner)).cards.find((item) => item.id === first.cardIds[0])!;
    await push(owner, {
      type: 'card.delete',
      operationId: randomUUID(),
      deviceId,
      createdAt: new Date().toISOString(),
      baseVersion: card.version,
      payload: { id: card.id },
    });
    expect(recallInsightsSchema.parse((await get('days=all')).json()).summary.reviewCount).toBe(1);
  });

  it('blocks connections in both directions, revokes shares, and never restores friendship on unblock', async () => {
    const sender = await login('Sender'),
      recipient = await login('Recipient');
    await connect(sender, recipient);
    const deck = await library(sender);
    const published = await share(sender, recipient, deck.deckId, true);
    await accept(recipient, published.id, true);
    const beforeBlock = await invite(sender);
    const block = await app.inject({
      method: 'POST',
      url: '/v1/community/blocks/' + sender.user.id.toUpperCase(),
      headers: headers(recipient),
    });
    expect(block.statusCode, block.body).toBe(204);
    const list = await app.inject({
      method: 'GET',
      url: '/v1/community/blocks',
      headers: headers(recipient),
    });
    expect(list.json()).toEqual({ users: [{ id: sender.user.id, name: 'Sender' }] });
    expect(
      (
        await app.inject({ method: 'GET', url: '/v1/community/blocks', headers: headers(sender) })
      ).json(),
    ).toEqual({ users: [] });
    for (const account of [sender, recipient]) {
      expect(
        (
          await app.inject({ method: 'GET', url: '/v1/community', headers: headers(account) })
        ).json(),
      ).toEqual({ friends: [], shares: [] });
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/v1/community/shares/' + published.id,
            headers: headers(account),
          })
        ).statusCode,
      ).toBe(404);
    }
    const reconnect = await app.inject({
      method: 'POST',
      url: '/v1/community/invites/accept',
      headers: headers(recipient),
      payload: { code: beforeBlock.code },
    });
    expect(reconnect.statusCode).toBe(404);
    const reverseInvite = await invite(recipient);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/community/invites/accept',
          headers: headers(sender),
          payload: { code: reverseInvite.code },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/v1/community/blocks/' + sender.user.id,
          headers: headers(recipient),
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({ method: 'GET', url: '/v1/community', headers: headers(recipient) })
      ).json(),
    ).toEqual({ friends: [], shares: [] });
    await connect(sender, recipient);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/community/shares/' + published.id,
          headers: headers(recipient),
        })
      ).statusCode,
    ).toBe(404);
  });

  it('records only known-user reports and participant-scoped evidence, including after blocking', async () => {
    const sender = await login(),
      recipient = await login(),
      outsider = await login();
    await connect(sender, recipient);
    const deck = await library(sender);
    const published = await share(sender, recipient, deck.deckId);
    const report = (account: Session, targetUserId: string, shareId?: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/community/reports',
        headers: headers(account),
        payload: {
          targetUserId,
          shareId,
          reason: 'inappropriate',
          details: 'Please review the shared content.',
        },
      });
    expect((await report(outsider, sender.user.id, published.id)).statusCode).toBe(404);
    await app.inject({
      method: 'POST',
      url: '/v1/community/blocks/' + sender.user.id,
      headers: headers(recipient),
    });
    const response = await report(recipient, sender.user.id, published.id);
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({
      id: expect.any(String),
      createdAt: expect.any(String),
    });
    const stored = (
      await db.query<{ evidence: { deck: { id: string } } }>(
        'SELECT evidence FROM recollect.content_reports WHERE id=$1',
        [response.json().id],
      )
    ).rows[0]!;
    expect(stored.evidence.deck.id).toBe(deck.deckId);
    expect((await report(recipient, sender.user.id, randomUUID())).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/community/reports', headers: headers(sender) }))
        .statusCode,
    ).toBe(404);
  });

  it('rejects shared threats while keeping the private source deck and educational subjects intact', async () => {
    const sender = await login(),
      recipient = await login();
    await connect(sender, recipient);
    const deck = await library(sender, 'I will kill you', 1);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/community/shares',
      headers: headers(sender),
      payload: {
        operationId: randomUUID(),
        friendId: recipient.user.id,
        deckId: deck.deckId,
        shareProgress: false,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('content_not_allowed');
    expect((await snapshot(sender)).decks.some((item) => item.id === deck.deckId)).toBe(true);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/v1/profile',
          headers: headers(sender),
          payload: { name: 'Go kill yourself' },
        })
      ).json().error.code,
    ).toBe('content_not_allowed');
    const safe = await library(sender, 'Italian', 1);
    expect((await share(sender, recipient, safe.deckId)).id).toBeTruthy();
  });

  it('rejects oversized or empty decks explicitly instead of silently truncating shared content', async () => {
    const sender = await login(),
      recipient = await login();
    await connect(sender, recipient);
    const original = await library(sender, 'Huge deck', 1);
    const template = (await snapshot(sender)).cards[0]!;
    const ids = Array.from({ length: 1000 }, () => randomUUID());
    await db.query(
      `INSERT INTO recollect.cards(owner_id,id,deck_id,data,checkpoint,checkpoint_at)
       SELECT $1,x.id,$2,jsonb_set($3::jsonb,'{id}',to_jsonb(x.id::text)),$4,$5 FROM unnest($6::uuid[]) AS x(id)`,
      [sender.user.id, original.deckId, template, template.schedule, createdAt, ids],
    );
    const response = await app.inject({
      method: 'POST',
      url: '/v1/community/shares',
      headers: headers(sender),
      payload: {
        operationId: randomUUID(),
        friendId: recipient.user.id,
        deckId: original.deckId,
        shareProgress: false,
      },
    });
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().error.code).toBe('deck_too_large');
    const empty = await library(sender, 'Empty', 0);
    const noCards = await app.inject({
      method: 'POST',
      url: '/v1/community/shares',
      headers: headers(sender),
      payload: {
        operationId: randomUUID(),
        friendId: recipient.user.id,
        deckId: empty.deckId,
        shareProgress: false,
      },
    });
    expect(noCards.json().error.code).toBe('empty_deck');
  });
});
