import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  ALGORITHM_VERSION,
  cardInput,
  marketplaceCatalogSchema,
  marketplaceDetailSchema,
  marketplaceDownloadSchema,
  marketplaceDownloadsSchema,
  marketplaceListingSchema,
  marketplaceMineSchema,
  marketplaceSnapshotValue,
  sessionSchema,
  snapshotSchema,
  type Card,
  type MarketplacePublish,
  type MarketplaceSettings,
  type ReviewEvent,
  type Session,
  type SyncOperation,
} from '@recollect/contracts';
import { createDatabase, hash, secretHash, type Database } from '@recollect/db';
import { migrate } from '@recollect/db/migrate';
import { buildApp } from '../src/app.js';
import type { ApiConfig } from '../src/config.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('snapshot deck marketplace', () => {
  let db: Database, app: FastifyInstance;
  const config: ApiConfig = {
    databaseUrl: process.env.TEST_DATABASE_URL ?? '',
    accessSecret: 'marketplace-test-only-signing-key-32-characters',
    appleAudience: 'test.recollect',
    production: false,
    enableDevAuth: false,
    accessTtlSeconds: 900,
    refreshTtlSeconds: 86_400,
    dailyGenerationCards: 100,
  };
  const deviceId = randomUUID();
  const createdAt = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const sequences = new Map<string, number>();
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
    sequences.clear();
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
      response.body,
    ).toBe(true);
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
  async function snapshot(session: Session) {
    const response = await app.inject({ url: '/v1/snapshot', headers: headers(session) });
    expect(response.statusCode, response.body).toBe(200);
    return snapshotSchema.parse(response.json());
  }
  async function publishRequest(session: Session, deckId: string): Promise<MarketplacePublish> {
    const source = await snapshot(session);
    const deck = source.decks.find((deck) => deck.id === deckId)!;
    return {
      operationId: randomUUID(),
      deckId,
      expectedContentHash: hash(
        marketplaceSnapshotValue(
          deck,
          source.cards.filter((card) => card.deckId === deckId),
        ),
      ),
      rightsAccepted: true,
      showDownloadCount: false,
      showUsageStats: false,
    };
  }
  const publishResponse = (session: Session, payload: MarketplacePublish) =>
    app.inject({
      method: 'POST',
      url: '/v1/marketplace/listings',
      headers: headers(session),
      payload,
    });
  async function publish(session: Session, deckId: string) {
    const request = await publishRequest(session, deckId);
    const response = await publishResponse(session, request);
    expect(response.statusCode, response.body).toBe(200);
    return { listing: marketplaceListingSchema.parse(response.json()), request };
  }
  async function settings(session: Session, id: string, payload: MarketplaceSettings) {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/marketplace/listings/${id}`,
      headers: headers(session),
      payload,
    });
    expect(response.statusCode, response.body).toBe(200);
    return marketplaceListingSchema.parse(response.json());
  }
  const detailResponse = (session: Session, id: string) =>
    app.inject({ url: `/v1/marketplace/listings/${id}`, headers: headers(session) });
  async function detail(session: Session, id: string) {
    const response = await detailResponse(session, id);
    expect(response.statusCode, response.body).toBe(200);
    return marketplaceDetailSchema.parse(response.json());
  }
  async function catalog(session: Session, query = '') {
    const response = await app.inject({
      url: '/v1/marketplace' + (query ? '?' + query : ''),
      headers: headers(session),
    });
    expect(response.statusCode, response.body).toBe(200);
    return marketplaceCatalogSchema.parse(response.json());
  }
  const downloadResponse = (session: Session, id: string) =>
    app.inject({
      method: 'POST',
      url: `/v1/marketplace/listings/${id}/download`,
      headers: headers(session),
      payload: {},
    });
  async function download(session: Session, id: string) {
    const response = await downloadResponse(session, id);
    expect(response.statusCode, response.body).toBe(200);
    return marketplaceDownloadSchema.parse(response.json());
  }
  async function usage(session: Session, id: string, enabled: boolean) {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/marketplace/listings/${id}/usage`,
      headers: headers(session),
      payload: { enabled },
    });
    expect(response.statusCode, response.body).toBe(200);
    return marketplaceDownloadSchema.parse(response.json());
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
  async function review(session: Session, card: Card, rating: ReviewEvent['rating'] = 'good') {
    const sequence = (sequences.get(session.user.id) ?? 0) + 1;
    sequences.set(session.user.id, sequence);
    const event: ReviewEvent = {
      id: randomUUID(),
      cardId: card.id,
      deckId: card.deckId,
      deviceId,
      deviceSequence: sequence,
      rating,
      reviewedAt: new Date().toISOString(),
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
  async function consentInPast(session: Session, id: string) {
    await usage(session, id, true);
    // Avoid depending on sub-millisecond wall-clock ordering in the fixture.
    await db.query(
      "UPDATE recollect.marketplace_downloads SET consent_since=now()-interval '1 second' WHERE recipient_id=$1 AND listing_id=$2",
      [session.user.id, id],
    );
  }
  async function learners(id: string, count = 5) {
    const result: { session: Session; card: Card }[] = [];
    for (let index = 0; index < count; index++) {
      const session = await login('Learner ' + index);
      const receipt = await download(session, id);
      const card = (await snapshot(session)).cards.find((card) => card.deckId === receipt.deckId)!;
      await consentInPast(session, id);
      await review(session, card);
      result.push({
        session,
        card: (await snapshot(session)).cards.find((item) => item.id === card.id)!,
      });
    }
    return result;
  }

  it('requires sign-in, explicit rights acceptance, and an owned nonempty deck', async () => {
    expect((await app.inject({ url: '/v1/marketplace' })).statusCode).toBe(401);
    const owner = await login('Publisher'),
      stranger = await login();
    const source = await library(owner);
    const request = await publishRequest(owner, source.deckId);
    expect((await publishResponse(stranger, request)).statusCode).toBe(404);
    const { rightsAccepted: _rights, ...missingRights } = request;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/marketplace/listings',
          headers: headers(owner),
          payload: missingRights,
        })
      ).statusCode,
    ).toBe(400);
    const empty = await library(owner, 'Empty', 0);
    expect(
      (await publishResponse(owner, await publishRequest(owner, empty.deckId))).statusCode,
    ).toBe(400);
    expect((await catalog(stranger)).listings).toHaveLength(0);
    const response = await app.inject({ url: '/v1/marketplace', headers: headers(owner) });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('rejects oversized snapshots before publishing or retaining any public version', async () => {
    const publisher = await login();
    const source = await library(publisher, 'Too much text', 80);
    await db.query(
      `UPDATE recollect.cards SET data=jsonb_set(data,'{back}',to_jsonb(repeat('x',30000))) WHERE owner_id=$1 AND deck_id=$2`,
      [publisher.user.id, source.deckId],
    );
    const response = await app.inject({
      method: 'POST',
      url: '/v1/marketplace/listings',
      headers: headers(publisher),
      payload: await publishRequest(publisher, source.deckId),
    });
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().error.code).toBe('deck_too_large');
    expect(
      (await db.query('SELECT count(*)::integer AS n FROM recollect.marketplace_listings')).rows[0]
        .n,
    ).toBe(0);
    expect(
      (await db.query('SELECT count(*)::integer AS n FROM recollect.marketplace_versions')).rows[0]
        .n,
    ).toBe(0);
  });

  it('publishes only a versioned snapshot with no live library, schedule, or identity details', async () => {
    const owner = await login('Publisher'),
      viewer = await login();
    const source = await library(owner, 'Italian', 6);
    const secret = await library(owner, 'Private journal');
    await review(owner, (await snapshot(owner)).cards[0]!);
    const { listing } = await publish(owner, source.deckId);
    expect(listing.sourceDeckId).toBe(source.deckId);
    expect(listing.showDownloadCount).toBe(false);
    expect(listing.showUsageStats).toBe(false);
    const publicDetail = await detail(viewer, listing.id);
    expect(publicDetail.listing.sourceDeckId).toBeNull();
    expect(publicDetail.listing.downloadCount).toBeNull();
    expect(publicDetail.listing.usageStats).toBeNull();
    expect(publicDetail.cards).toHaveLength(5);
    const serialized = JSON.stringify(publicDetail);
    for (const privateValue of [
      secret.deckId,
      source.deckId,
      ...source.cardIds,
      owner.user.email!,
      'schedule',
      'reviewedAt',
    ])
      expect(serialized).not.toContain(privateValue);
    expect((await catalog(viewer)).listings.map((item) => item.id)).toEqual([listing.id]);
  });

  it('keeps source edits private until explicit publication and retries without making extra versions', async () => {
    const owner = await login(),
      viewer = await login();
    const source = await library(owner);
    const first = await publish(owner, source.deckId);
    let card = (await snapshot(owner)).cards.find((card) => card.id === source.cardIds[0])!;
    card = await editCard(owner, card, 'Buongiorno');
    expect((await detail(viewer, first.listing.id)).cards.map((card) => card.front)).not.toContain(
      'Buongiorno',
    );
    const second = await publish(owner, source.deckId);
    expect(second.listing.id).toBe(first.listing.id);
    expect(second.listing.version).toBe(2);
    expect((await detail(viewer, first.listing.id)).cards.map((card) => card.front)).toContain(
      'Buongiorno',
    );
    const retry = await publishResponse(owner, second.request);
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json().version).toBe(2);
    const reused = await publishResponse(owner, { ...second.request, showUsageStats: true });
    expect(reused.statusCode).toBe(409);
    expect(
      (await db.query('SELECT count(*)::int AS n FROM recollect.marketplace_versions')).rows[0].n,
    ).toBe(2);
    expect((await snapshot(owner)).cards.find((item) => item.id === card.id)?.front).toBe(
      'Buongiorno',
    );
  });

  it('rejects unseen changes from another device and recovers accepted retries against the original hash', async () => {
    const owner = await login(),
      viewer = await login();
    const source = await library(owner, 'Reviewed deck', 1);
    const reviewedRequest = await publishRequest(owner, source.deckId);
    let card = (await snapshot(owner)).cards[0]!;
    const remoteDevice = randomUUID();
    const changeOnOtherDevice = async (front: string) => {
      await push(owner, {
        type: 'card.upsert',
        operationId: randomUUID(),
        deviceId: remoteDevice,
        createdAt: new Date().toISOString(),
        baseVersion: card.version,
        payload: { ...cardInput(card), front },
      });
      card = (await snapshot(owner)).cards.find((item) => item.id === card.id)!;
    };
    await changeOnOtherDevice('Unreviewed remote change');
    const firstMismatch = await publishResponse(owner, reviewedRequest);
    expect(firstMismatch.statusCode, firstMismatch.body).toBe(409);
    expect(firstMismatch.json().error.code).toBe('publication_changed');
    expect((await catalog(viewer)).listings).toHaveLength(0);
    expect(
      (await db.query('SELECT count(*)::int AS n FROM recollect.marketplace_versions')).rows[0].n,
    ).toBe(0);
    expect(
      (await db.query('SELECT count(*)::int AS n FROM recollect.marketplace_publish_operations'))
        .rows[0].n,
    ).toBe(0);

    // A new explicit review can authorize that content; further unseen edits must
    // still fail without changing the already-published snapshot or version.
    const accepted = await publish(owner, source.deckId);
    const reviewedUpdate = await publishRequest(owner, source.deckId);
    await changeOnOtherDevice('Private note that was never approved for publication');
    const updateMismatch = await publishResponse(owner, reviewedUpdate);
    expect(updateMismatch.statusCode, updateMismatch.body).toBe(409);
    expect(updateMismatch.json().error.code).toBe('publication_changed');
    expect((await detail(viewer, accepted.listing.id)).listing.version).toBe(1);
    expect((await detail(viewer, accepted.listing.id)).cards[0]!.front).toBe(
      'Unreviewed remote change',
    );
    expect(
      (await db.query('SELECT count(*)::int AS n FROM recollect.marketplace_versions')).rows[0].n,
    ).toBe(1);

    // Recovering a response lost after a successful commit uses its durable
    // receipt first; a changed live deck cannot force an accidental new version.
    const retry = await publishResponse(owner, accepted.request);
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json().id).toBe(accepted.listing.id);
    expect(retry.json().version).toBe(1);
    expect(
      (await db.query('SELECT count(*)::int AS n FROM recollect.marketplace_versions')).rows[0].n,
    ).toBe(1);
    expect((await detail(viewer, accepted.listing.id)).cards[0]!.front).not.toContain(
      'Private note',
    );
  });

  it('does not treat a private scheduling-only review as a changed public snapshot', async () => {
    const owner = await login();
    const source = await library(owner, 'Reviewed deck', 1);
    const reviewedRequest = await publishRequest(owner, source.deckId);
    await review(owner, (await snapshot(owner)).cards[0]!);
    const response = await publishResponse(owner, reviewedRequest);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().version).toBe(1);
  });

  it('keeps an existing download on its original version when a publisher updates the snapshot', async () => {
    const owner = await login(),
      firstLearner = await login(),
      nextLearner = await login();
    const source = await library(owner, 'Italian', 1);
    const { listing } = await publish(owner, source.deckId);
    const originalCopy = await download(firstLearner, listing.id);
    const sourceCard = (await snapshot(owner)).cards[0]!;
    await editCard(owner, sourceCard, 'Buongiorno');
    const update = await publish(owner, source.deckId);
    expect(update.listing.version).toBe(2);
    const nextCopy = await download(nextLearner, listing.id);
    expect(nextCopy.version).toBe(2);
    expect((await snapshot(nextLearner)).cards[0]!.front).toBe('Buongiorno');
    expect(await download(firstLearner, listing.id)).toEqual(originalCopy);
    expect((await snapshot(firstLearner)).cards[0]!.front).toBe('Ciao');
  });

  it('paginates tied PostgreSQL timestamps without losing listings and validates untrusted cursors', async () => {
    const owner = await login(),
      viewer = await login();
    const ids: string[] = [];
    for (const name of ['Italian phrases', 'Italian nouns', 'Italian verbs']) {
      const source = await library(owner, name, 1);
      ids.push((await publish(owner, source.deckId)).listing.id);
    }
    // pg returns Date values at millisecond precision; a cursor must retain the
    // database's exact ordering value rather than truncate this shared timestamp.
    await db.query(
      "UPDATE recollect.marketplace_listings SET published_at='2026-10-20T12:00:00.123456Z'",
    );
    const first = await catalog(viewer, 'limit=1&query=Italian');
    expect(first.listings).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await catalog(
      viewer,
      'limit=1&query=Italian&cursor=' + encodeURIComponent(first.nextCursor!),
    );
    expect(second.listings).toHaveLength(1);
    const third = await catalog(
      viewer,
      'limit=1&query=Italian&cursor=' + encodeURIComponent(second.nextCursor!),
    );
    expect(third.listings).toHaveLength(1);
    expect(third.nextCursor).toBeNull();
    expect(
      [...first.listings, ...second.listings, ...third.listings]
        .map((listing) => listing.id)
        .sort(),
    ).toEqual(ids.sort());
    expect(
      (await app.inject({ url: '/v1/marketplace?cursor=not-a-cursor', headers: headers(viewer) }))
        .statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ url: '/v1/marketplace?limit=51', headers: headers(viewer) })).statusCode,
    ).toBe(400);
    expect((await catalog(viewer, 'query=NoMatch')).listings).toHaveLength(0);
  });

  it('downloads fresh private identities and schedules exactly once under simultaneous retries', async () => {
    const owner = await login(),
      learner = await login();
    const source = await library(owner);
    const { listing } = await publish(owner, source.deckId);
    const responses = await Promise.all([
      downloadResponse(learner, listing.id),
      downloadResponse(learner, listing.id),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    const receipts = responses.map((response) => marketplaceDownloadSchema.parse(response.json()));
    expect(receipts[0]).toEqual(receipts[1]);
    expect(receipts[0]!.deckId).not.toBe(source.deckId);
    expect(receipts[0]!.contributeUsage).toBe(false);
    const copy = await snapshot(learner);
    expect(copy.decks).toHaveLength(1);
    expect(copy.cards).toHaveLength(2);
    expect(
      copy.cards.every(
        (card) =>
          card.ownerId === learner.user.id &&
          !source.cardIds.includes(card.id) &&
          card.schedule.totalReviews === 0,
      ),
    ).toBe(true);
    expect((await downloadResponse(owner, listing.id)).statusCode).toBe(400);
    expect(
      (await db.query('SELECT count(*)::int AS n FROM recollect.marketplace_downloads')).rows[0].n,
    ).toBe(1);
  });

  it('preserves independent edits, revoked usage consent, and deleted copies on download retry', async () => {
    const owner = await login(),
      learner = await login();
    const { deckId } = await library(owner);
    const { listing } = await publish(owner, deckId);
    const original = await download(learner, listing.id);
    const copy = await snapshot(learner);
    await editCard(learner, copy.cards[0]!, 'My own wording');
    await usage(learner, listing.id, true);
    await usage(learner, listing.id, false);
    expect(await download(learner, listing.id)).toEqual(original);
    expect((await snapshot(learner)).cards[0]!.front).toBe('My own wording');
    await push(learner, {
      type: 'deck.delete',
      operationId: randomUUID(),
      deviceId,
      createdAt: new Date().toISOString(),
      baseVersion: copy.decks[0]!.version,
      payload: { id: original.deckId },
    });
    const afterDelete = await snapshot(learner);
    expect(await download(learner, listing.id)).toEqual(original);
    expect((await snapshot(learner)).cursor).toBe(afterDelete.cursor);
    expect((await snapshot(learner)).decks.filter((deck) => !deck.deletedAt)).toHaveLength(0);
    const enable = await app.inject({
      method: 'PATCH',
      url: `/v1/marketplace/listings/${listing.id}/usage`,
      headers: headers(learner),
      payload: { enabled: true },
    });
    expect(enable.statusCode).toBe(409);
    expect((await usage(learner, listing.id, false)).contributeUsage).toBe(false);
  });

  it('enforces owner controls in every response and counts distinct downloaded accounts only', async () => {
    const owner = await login(),
      a = await login(),
      b = await login();
    const source = await library(owner);
    const { listing } = await publish(owner, source.deckId);
    await download(a, listing.id);
    await download(a, listing.id);
    await download(b, listing.id);
    expect((await detail(owner, listing.id)).listing.downloadCount).toBeNull();
    await settings(owner, listing.id, { showDownloadCount: true });
    expect((await detail(a, listing.id)).listing.downloadCount).toBe(2);
    expect((await catalog(b)).listings[0]!.downloadCount).toBe(2);
    await settings(owner, listing.id, { showDownloadCount: false, showUsageStats: false });
    expect((await detail(owner, listing.id)).listing.downloadCount).toBeNull();
    expect((await catalog(a)).listings[0]!.downloadCount).toBeNull();
    const mine = await app.inject({ url: '/v1/marketplace/mine', headers: headers(owner) });
    expect(marketplaceMineSchema.parse(mine.json()).listings[0]!.downloadCount).toBeNull();
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/v1/marketplace/listings/${listing.id}`,
          headers: headers(a),
          payload: { showDownloadCount: true },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('unpublishes discovery and new downloads while retaining copies and revocable consent', async () => {
    const owner = await login(),
      learner = await login(),
      stranger = await login();
    const { deckId } = await library(owner);
    const { listing } = await publish(owner, deckId);
    const copy = await download(learner, listing.id);
    await usage(learner, listing.id, true);
    await settings(owner, listing.id, { isPublished: false });
    expect((await catalog(learner)).listings).toHaveLength(0);
    expect((await detailResponse(stranger, listing.id)).statusCode).toBe(404);
    expect((await downloadResponse(stranger, listing.id)).statusCode).toBe(404);
    expect((await detail(owner, listing.id)).listing.isPublished).toBe(false);
    const list = await app.inject({ url: '/v1/marketplace/downloads', headers: headers(learner) });
    expect(marketplaceDownloadsSchema.parse(list.json()).downloads).toHaveLength(1);
    expect((await usage(learner, listing.id, false)).contributeUsage).toBe(false);
    expect(
      (await snapshot(learner)).decks.find((deck) => deck.id === copy.deckId)?.deletedAt,
    ).toBeNull();
    await settings(owner, listing.id, { isPublished: true });
    expect((await catalog(stranger)).listings.map((item) => item.id)).toEqual([listing.id]);
  });

  it('accepts reports and publisher blocks without requiring a friendship', async () => {
    const owner = await login(),
      learner = await login();
    const { deckId } = await library(owner);
    const { listing } = await publish(owner, deckId);
    await download(learner, listing.id);
    await usage(learner, listing.id, true);
    const report = await app.inject({
      method: 'POST',
      url: `/v1/marketplace/listings/${listing.id}/reports`,
      headers: headers(learner),
      payload: { reason: 'inappropriate', details: 'Please review this public deck.' },
    });
    expect(report.statusCode, report.body).toBe(201);
    expect(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM recollect.marketplace_reports WHERE listing_id=$1',
          [listing.id],
        )
      ).rows[0].n,
    ).toBe(1);
    const blocked = await app.inject({
      method: 'POST',
      url: `/v1/marketplace/listings/${listing.id}/block-publisher`,
      headers: headers(learner),
      payload: {},
    });
    expect(blocked.statusCode, blocked.body).toBe(204);
    expect((await catalog(learner)).listings).toHaveLength(0);
    expect((await detailResponse(learner, listing.id)).statusCode).toBe(404);
    expect((await downloadResponse(learner, listing.id)).statusCode).toBe(404);
    const downloads = await app.inject({
      url: '/v1/marketplace/downloads',
      headers: headers(learner),
    });
    expect(marketplaceDownloadsSchema.parse(downloads.json()).downloads[0]!.contributeUsage).toBe(
      false,
    );
    const unblock = await app.inject({
      method: 'DELETE',
      url: `/v1/community/blocks/${owner.user.id}`,
      headers: headers(learner),
    });
    expect(unblock.statusCode).toBe(204);
    expect((await detail(learner, listing.id)).listing.download?.contributeUsage).toBe(false);
    expect((await snapshot(learner)).decks.filter((deck) => !deck.deletedAt)).toHaveLength(1);
  });

  it('can revoke a contribution while its publisher account is inactive', async () => {
    const owner = await login(),
      learner = await login();
    const { deckId } = await library(owner);
    const { listing } = await publish(owner, deckId);
    await download(learner, listing.id);
    await usage(learner, listing.id, true);
    await db.query('UPDATE recollect.users SET is_active=false WHERE id=$1', [owner.user.id]);
    expect((await usage(learner, listing.id, false)).contributeUsage).toBe(false);
    expect((await catalog(learner)).listings).toHaveLength(0);
  });

  it('suppresses usage below five eligible consenting learners and exposes only coarse deck-wide bands', async () => {
    const owner = await login(),
      viewer = await login();
    const { deckId } = await library(owner, 'Study', 1);
    const { listing } = await publish(owner, deckId);
    await settings(owner, listing.id, { showUsageStats: true });
    const group = await learners(listing.id, 4);
    expect((await detail(viewer, listing.id)).listing.usageStats).toBeNull();
    const fifth = await learners(listing.id, 1);
    group.push(...fifth);
    const stats = (await detail(viewer, listing.id)).listing.usageStats;
    expect(stats).toEqual({
      learnerBand: '5–9',
      reviewBand: '1–9',
      recallBand: 'mostly_remembered',
      windowDays: 30,
    });
    const serialized = JSON.stringify(stats);
    for (const learner of group) expect(serialized).not.toContain(learner.session.user.id);
    expect(Object.keys(stats!).sort()).toEqual([
      'learnerBand',
      'recallBand',
      'reviewBand',
      'windowDays',
    ]);
    await settings(owner, listing.id, { showUsageStats: false });
    expect((await detail(owner, listing.id)).listing.usageStats).toBeNull();
    expect((await catalog(viewer)).listings[0]!.usageStats).toBeNull();
    await settings(owner, listing.id, { showUsageStats: true });
    expect((await detail(viewer, listing.id)).listing.usageStats).toEqual(stats);
    await usage(group[0]!.session, listing.id, false);
    expect((await detail(viewer, listing.id)).listing.usageStats).toBeNull();
  });

  it('counts reviews only after the most recent opt-in and within the fixed 30-day window', async () => {
    const owner = await login(),
      viewer = await login();
    const { deckId } = await library(owner, 'Study', 1);
    const { listing } = await publish(owner, deckId);
    await settings(owner, listing.id, { showUsageStats: true });
    const group = await learners(listing.id, 5);
    expect((await detail(viewer, listing.id)).listing.usageStats).not.toBeNull();
    const subject = group[0]!;
    await usage(subject.session, listing.id, false);
    await usage(subject.session, listing.id, true);
    // An explicit new grant cannot retroactively include this learner's older reviews.
    await db.query(
      "UPDATE recollect.marketplace_downloads SET consent_since=now()+interval '1 second' WHERE recipient_id=$1 AND listing_id=$2",
      [subject.session.user.id, listing.id],
    );
    expect((await detail(viewer, listing.id)).listing.usageStats).toBeNull();
    await consentInPast(subject.session, listing.id);
    await review(subject.session, subject.card);
    expect((await detail(viewer, listing.id)).listing.usageStats).not.toBeNull();
    await db.query(
      "UPDATE recollect.review_events SET reviewed_at=now()-interval '31 days',data=jsonb_set(data,'{reviewedAt}',to_jsonb((now()-interval '31 days')::text)) WHERE owner_id=$1",
      [subject.session.user.id],
    );
    expect((await detail(viewer, listing.id)).listing.usageStats).toBeNull();
  });

  it('excludes edited or deleted cards and inactive accounts from usage immediately', async () => {
    const owner = await login(),
      viewer = await login();
    const { deckId } = await library(owner, 'Study', 1);
    const { listing } = await publish(owner, deckId);
    await settings(owner, listing.id, { showUsageStats: true });
    const group = await learners(listing.id, 6);
    let first = group[0]!.card;
    first = await editCard(group[0]!.session, first, 'My private answer');
    expect((await detail(viewer, listing.id)).listing.usageStats).not.toBeNull();
    await editCard(group[0]!.session, first, group[0]!.card.front);
    // Reverting an edit must not make private intervening activity public again.
    await db.query('UPDATE recollect.users SET is_active=false WHERE id=$1', [
      group[1]!.session.user.id,
    ]);
    expect((await detail(viewer, listing.id)).listing.usageStats).toBeNull();
    await db.query('UPDATE recollect.users SET is_active=true WHERE id=$1', [
      group[1]!.session.user.id,
    ]);
    const second = (await snapshot(group[1]!.session)).cards[0]!;
    await push(group[1]!.session, {
      type: 'card.delete',
      operationId: randomUUID(),
      deviceId,
      createdAt: new Date().toISOString(),
      baseVersion: second.version,
      payload: { id: second.id },
    });
    expect((await detail(viewer, listing.id)).listing.usageStats).toBeNull();
  });
});
