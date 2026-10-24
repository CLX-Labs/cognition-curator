import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  ALGORITHM_VERSION,
  deckSchema,
  marketplaceSnapshotValue,
  sessionSchema,
  snapshotSchema,
  type Session,
  type SyncOperation,
} from '@recollect/contracts';
import { createDatabase, hash, secretHash, type Database } from '@recollect/db';
import { migrate } from '@recollect/db/migrate';
import { buildApp } from '../src/app.js';
import type { ApiConfig } from '../src/config.js';
import { deckImage } from './deck-image-fixture.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'deck image storage and legacy compatibility',
  () => {
    let db: Database, app: FastifyInstance;
    const config: ApiConfig = {
      databaseUrl: process.env.TEST_DATABASE_URL ?? '',
      accessSecret: 'deck-image-test-signing-secret-32-characters',
      appleAudience: 'test.recollect',
      production: false,
      enableDevAuth: false,
      accessTtlSeconds: 900,
      refreshTtlSeconds: 86400,
      dailyGenerationCards: 100,
    };
    const deviceId = randomUUID();
    const headers = (session: Session, images = true) => ({
      authorization: 'Bearer ' + session.accessToken,
      'x-recollect-scheduler': ALGORITHM_VERSION,
      ...(images ? { 'x-recollect-deck-images': '1' } : {}),
    });
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
    });
    afterAll(async () => {
      await app?.close();
      await db?.end();
    });
    async function login() {
      const challenge = (
        await app.inject({ method: 'POST', url: '/v1/auth/apple/challenge' })
      ).json();
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/apple',
        payload: {
          challengeId: challenge.challengeId,
          identityToken: JSON.stringify({ sub: randomUUID(), nonce: secretHash(challenge.nonce) }),
          displayName: 'Learner',
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      return sessionSchema.parse(response.json());
    }
    async function push(
      session: Session,
      operation: SyncOperation,
      images = true,
      url = '/v1/sync/push',
    ) {
      const response = await app.inject({
        method: 'POST',
        url,
        headers: headers(session, images),
        payload: url.endsWith('/commands') ? operation : { operations: [operation] },
      });
      expect(response.statusCode, response.body).toBe(200);
      return response;
    }
    const read = async (session: Session) =>
      snapshotSchema.parse(
        (await app.inject({ url: '/v1/snapshot', headers: headers(session) })).json(),
      );
    function upsert(id: string, baseVersion: number, imageDataUrl?: string | null): SyncOperation {
      return {
        type: 'deck.upsert',
        operationId: randomUUID(),
        deviceId,
        createdAt: new Date().toISOString(),
        baseVersion,
        payload: {
          id,
          name: 'Italian',
          description: 'Vocabulary',
          color: '#2441EA',
          icon: '📚',
          isSilenced: false,
          silencedUntil: null,
          ...(imageDataUrl !== undefined ? { imageDataUrl } : {}),
        },
      };
    }
    async function source(session: Session) {
      const id = randomUUID();
      expect((await push(session, upsert(id, 0, deckImage))).json().receipts[0].status).toBe(
        'accepted',
      );
      await push(session, {
        type: 'card.upsert',
        operationId: randomUUID(),
        deviceId,
        createdAt: new Date().toISOString(),
        baseVersion: 0,
        payload: {
          id: randomUUID(),
          deckId: id,
          front: 'Ciao',
          back: 'Hello',
          hint: '',
          explanation: '',
          tags: [],
          aiGenerated: false,
        },
      });
      return id;
    }

    it('preserves covers on legacy omitted-field edits and hides them in every legacy sync response', async () => {
      const owner = await login(),
        id = await source(owner),
        initial = (await read(owner)).decks[0]!;
      expect(initial.imageDataUrl).toBe(deckImage);
      const legacy = await app.inject({ url: '/v1/snapshot', headers: headers(owner, false) });
      const legacyDeck = legacy.json().decks[0];
      expect(deckSchema.omit({ imageDataUrl: true }).parse(legacyDeck).id).toBe(id);
      expect(legacy.headers.vary).toContain('X-Recollect-Deck-Images');
      const edit = upsert(id, initial.version);
      const edited = await push(owner, edit, false, '/v1/decks/commands');
      expect(edited.body).not.toContain('imageDataUrl');
      expect((await read(owner)).decks[0]!.imageDataUrl).toBe(deckImage);
      expect((await push(owner, edit, false)).body).not.toContain('imageDataUrl');
      expect((await push(owner, upsert(id, 1), false)).body).not.toContain('imageDataUrl');
      const pull = await app.inject({
        url: '/v1/sync/pull?cursor=0',
        headers: headers(owner, false),
      });
      expect(pull.statusCode, pull.body).toBe(200);
      expect(pull.body).not.toContain('imageDataUrl');
      const modernPull = await app.inject({
        url: '/v1/sync/pull?cursor=0',
        headers: headers(owner),
      });
      expect(modernPull.body).toContain('imageDataUrl');
      const list = await app.inject({ url: '/v1/decks', headers: headers(owner, false) });
      expect(list.body).not.toContain('imageDataUrl');
      const current = (await read(owner)).decks[0]!;
      await push(owner, upsert(id, current.version, null));
      expect((await read(owner)).decks[0]!.imageDataUrl).toBeNull();
    });

    it('rejects invalid images and foreign identity writes without modifying the owned cover', async () => {
      const owner = await login(),
        stranger = await login(),
        id = await source(owner);
      const response = await push(owner, upsert(id, 1, 'data:image/jpeg;base64,/9j/2Q=='));
      expect(response.json().receipts[0]).toMatchObject({
        status: 'rejected',
        error: { code: 'invalid_deck_image' },
      });
      const foreign = (await push(stranger, upsert(id, 1, deckImage))).json().receipts[0];
      expect(foreign.status).toBe('conflict');
      expect(foreign).not.toHaveProperty('canonical');
      expect((await read(owner)).decks[0]!.imageDataUrl).toBe(deckImage);
      expect((await read(stranger)).decks).toHaveLength(0);
    });

    // The WASM PostgreSQL socket adapter misorders wire messages after this unique
    // constraint/savepoint path. Keep the actual hostile create covered on PG16 CI.
    it.skipIf(process.env.RECOLLECT_EMBEDDED_TEST === 'true')(
      'rejects a foreign create with a reused identity without exposing or overwriting its cover',
      async () => {
        const owner = await login(),
          stranger = await login(),
          id = await source(owner);
        const response = (await push(stranger, upsert(id, 0, deckImage))).json().receipts[0];
        expect(response).toMatchObject({
          status: 'rejected',
          error: { code: 'identity_conflict' },
        });
        expect(response).not.toHaveProperty('canonical');
        expect((await read(owner)).decks[0]!.imageDataUrl).toBe(deckImage);
        expect((await read(stranger)).decks).toHaveLength(0);
      },
    );

    it('validates recovery imports before retaining any image or manifest', async () => {
      const owner = await login(),
        operation = upsert(randomUUID(), 0, 'data:image/jpeg;base64,/9j/2Q==');
      if (operation.type !== 'deck.upsert') throw new Error('Expected deck fixture');
      const body = {
        batchId: randomUUID(),
        source: 'manual-recovery',
        exportedAt: new Date().toISOString(),
        sourceAccountId: owner.user.id,
        ownershipConfirmed: true,
        decks: [operation.payload],
        cards: [],
        archivedReviews: [],
      };
      const rejected = await app.inject({
        method: 'POST',
        url: '/v1/imports',
        headers: headers(owner),
        payload: body,
      });
      expect(rejected.statusCode, rejected.body).toBe(400);
      expect(rejected.json().error.code).toBe('invalid_deck_image');
      expect((await read(owner)).decks).toHaveLength(0);
      expect(
        (await db.query('SELECT count(*)::integer AS n FROM recollect.import_batches')).rows[0].n,
      ).toBe(0);
      const accepted = await app.inject({
        method: 'POST',
        url: '/v1/imports',
        headers: headers(owner),
        payload: {
          ...body,
          decks: [{ ...operation.payload, imageDataUrl: deckImage }],
        },
      });
      expect(accepted.statusCode, accepted.body).toBe(200);
      expect((await read(owner)).decks[0]!.imageDataUrl).toBe(deckImage);
    });

    it('binds marketplace images to reviewed snapshots, keeps old responses strict, and copies covers independently', async () => {
      const owner = await login(),
        learner = await login(),
        id = await source(owner),
        original = await read(owner),
        deck = original.decks[0]!;
      const publish = async (expectedContentHash: string) =>
        app.inject({
          method: 'POST',
          url: '/v1/marketplace/listings',
          headers: headers(owner),
          payload: {
            operationId: randomUUID(),
            deckId: id,
            rightsAccepted: true,
            expectedContentHash,
          },
        });
      const { imageDataUrl: _image, ...withoutImage } = deck;
      expect(
        (await publish(hash(marketplaceSnapshotValue(withoutImage, original.cards)))).json().error
          .code,
      ).toBe('publication_changed');
      const publication = await publish(hash(marketplaceSnapshotValue(deck, original.cards)));
      expect(publication.statusCode, publication.body).toBe(200);
      expect(publication.json().deck.imageDataUrl).toBe(deckImage);
      const listingId = publication.json().id;
      for (const path of [
        '/v1/marketplace',
        '/v1/marketplace/mine',
        '/v1/marketplace/listings/' + listingId,
      ]) {
        const legacy = await app.inject({ url: path, headers: headers(owner, false) });
        expect(legacy.statusCode, legacy.body).toBe(200);
        expect(legacy.body).not.toContain('imageDataUrl');
      }
      const downloaded = await app.inject({
        method: 'POST',
        url: `/v1/marketplace/listings/${listingId}/download`,
        headers: headers(learner, false),
        payload: {},
      });
      expect(downloaded.statusCode, downloaded.body).toBe(200);
      const copied = (await read(learner)).decks.find(
        (item) => item.id === downloaded.json().deckId,
      )!;
      expect(copied.imageDataUrl).toBe(deckImage);
      await push(owner, upsert(id, deck.version, null));
      expect((await read(owner)).decks[0]!.imageDataUrl).toBeNull();
      expect((await read(learner)).decks[0]!.imageDataUrl).toBe(deckImage);
      const detail = (
        await app.inject({
          url: '/v1/marketplace/listings/' + listingId,
          headers: headers(learner),
        })
      ).json();
      expect(detail.listing.deck.imageDataUrl).toBe(deckImage);
      const updated = await read(owner),
        current = updated.decks[0]!;
      const legacyPublication = await app.inject({
        method: 'POST',
        url: '/v1/marketplace/listings',
        headers: headers(owner, false),
        payload: {
          operationId: randomUUID(),
          deckId: id,
          rightsAccepted: true,
          expectedContentHash: hash(
            marketplaceSnapshotValue({ ...current, imageDataUrl: undefined }, updated.cards),
          ),
        },
      });
      expect(legacyPublication.statusCode, legacyPublication.body).toBe(200);
      expect(legacyPublication.json().deck).not.toHaveProperty('imageDataUrl');
      expect((await read(learner)).decks[0]!.imageDataUrl).toBe(deckImage);
    });

    it('carries covers through friend snapshots and copies without breaking legacy community payloads', async () => {
      const owner = await login(),
        learner = await login(),
        id = await source(owner);
      const invite = (
        await app.inject({ method: 'POST', url: '/v1/community/invites', headers: headers(owner) })
      ).json();
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/community/invites/accept',
            headers: headers(learner),
            payload: { code: invite.code },
          })
        ).statusCode,
      ).toBe(200);
      const offer = await app.inject({
        method: 'POST',
        url: '/v1/community/shares',
        headers: headers(owner),
        payload: {
          operationId: randomUUID(),
          friendId: learner.user.id,
          deckId: id,
          shareProgress: false,
        },
      });
      expect(offer.statusCode, offer.body).toBe(200);
      expect(offer.json().deck.imageDataUrl).toBe(deckImage);
      const shareId = offer.json().id;
      for (const path of ['/v1/community', '/v1/community/shares/' + shareId]) {
        const legacy = await app.inject({ url: path, headers: headers(learner, false) });
        expect(legacy.statusCode, legacy.body).toBe(200);
        expect(legacy.body).not.toContain('imageDataUrl');
      }
      const accepted = await app.inject({
        method: 'POST',
        url: `/v1/community/shares/${shareId}/accept`,
        headers: headers(learner, false),
        payload: { shareProgress: false },
      });
      expect(accepted.statusCode, accepted.body).toBe(200);
      expect(accepted.body).not.toContain('imageDataUrl');
      expect((await read(learner)).decks[0]!.imageDataUrl).toBe(deckImage);
    });
  },
);
