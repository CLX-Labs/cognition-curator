import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  ALGORITHM_VERSION,
  marketplaceCatalogSchema,
  marketplaceDetailSchema,
  marketplaceDownloadSchema,
  sessionSchema,
  snapshotSchema,
  type Session,
} from '@recollect/contracts';
import { createDatabase, secretHash, type Database } from '@recollect/db';
import { migrate } from '@recollect/db/migrate';
import {
  buildStarterCatalog,
  loadStarterCatalog,
  RECOLLECT_AI_PUBLISHER_ID,
} from '../../../packages/db/src/starter-catalog.js';
import { buildApp } from '../src/app.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('Recollect AI starter marketplace', () => {
  let db: Database;
  let app: FastifyInstance;
  let catalog: ReturnType<typeof buildStarterCatalog>;
  beforeAll(async () => {
    db = createDatabase(process.env.TEST_DATABASE_URL!);
    await db.query('DROP SCHEMA IF EXISTS recollect CASCADE');
    await migrate(db);
    catalog = buildStarterCatalog(await loadStarterCatalog());
    app = await buildApp({
      db,
      config: {
        databaseUrl: process.env.TEST_DATABASE_URL!,
        accessSecret: 'starter-catalog-tests-only-signing-key',
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
  afterAll(async () => {
    await app?.close();
    await db?.end();
  });
  async function login(): Promise<Session> {
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
        displayName: 'Starter deck learner',
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    return sessionSchema.parse(response.json());
  }
  const headers = (session: Session) => ({
    authorization: 'Bearer ' + session.accessToken,
    'x-recollect-scheduler': ALGORITHM_VERSION,
    'x-recollect-deck-images': '1',
  });

  it('shows the seeded collection through the normal catalog with no fabricated activity', async () => {
    const viewer = await login();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/marketplace?limit=50',
      headers: headers(viewer),
    });
    expect(response.statusCode, response.body).toBe(200);
    const result = marketplaceCatalogSchema.parse(response.json());
    expect(result.listings).toHaveLength(catalog.decks.length);
    expect(result.nextCursor).toBeNull();
    for (const listing of result.listings) {
      expect(listing.publisher).toEqual({ id: RECOLLECT_AI_PUBLISHER_ID, name: 'Recollect AI' });
      expect(listing.cardCount).toBe(15);
      expect(listing.sourceDeckId).toBeNull();
      expect(listing.showDownloadCount).toBe(false);
      expect(listing.showUsageStats).toBe(false);
      expect(listing.downloadCount).toBeNull();
      expect(listing.usageStats).toBeNull();
      expect(listing.download).toBeNull();
    }
    const records = await db.query(
      `SELECT
      (SELECT count(*) FROM recollect.review_events WHERE owner_id=$1)::int AS reviews,
      (SELECT count(*) FROM recollect.sessions WHERE owner_id=$1)::int AS sessions,
      (SELECT count(*) FROM recollect.session_families WHERE owner_id=$1)::int AS families,
      (SELECT count(*) FROM recollect.marketplace_downloads)::int AS downloads`,
      [RECOLLECT_AI_PUBLISHER_ID],
    );
    expect(records.rows[0]).toEqual({ reviews: 0, sessions: 0, families: 0, downloads: 0 });
    expect(
      (
        await db.query('SELECT apple_id,email FROM recollect.users WHERE id=$1', [
          RECOLLECT_AI_PUBLISHER_ID,
        ])
      ).rows[0],
    ).toEqual({ apple_id: null, email: null });
  });

  it('previews and downloads all fifteen cards as an independent offline-ready copy', async () => {
    const viewer = await login();
    const italian = catalog.decks.find((deck) => deck.slug === 'italian-for-travel')!;
    const previewResponse = await app.inject({
      method: 'GET',
      url: '/v1/marketplace/listings/' + italian.listingId,
      headers: headers(viewer),
    });
    expect(previewResponse.statusCode, previewResponse.body).toBe(200);
    const preview = marketplaceDetailSchema.parse(previewResponse.json());
    expect(preview.cards).toHaveLength(5);
    expect(preview.cards.every((card) => card.aiGenerated)).toBe(true);
    const download = () =>
      app.inject({
        method: 'POST',
        url: '/v1/marketplace/listings/' + italian.listingId + '/download',
        headers: headers(viewer),
      });
    const downloaded = await download();
    expect(downloaded.statusCode, downloaded.body).toBe(200);
    const receipt = marketplaceDownloadSchema.parse(downloaded.json());
    expect(receipt.contributeUsage).toBe(false);
    expect(receipt.deckId).not.toBe(italian.deck.id);
    expect(marketplaceDownloadSchema.parse((await download()).json())).toEqual(receipt);
    const snapshotResponse = await app.inject({
      method: 'GET',
      url: '/v1/sync/snapshot',
      headers: headers(viewer),
    });
    expect(snapshotResponse.statusCode, snapshotResponse.body).toBe(200);
    const snapshot = snapshotSchema.parse(snapshotResponse.json());
    expect(snapshot.decks).toHaveLength(1);
    expect(snapshot.cards).toHaveLength(15);
    expect(snapshot.cards.map((card) => card.front).sort()).toEqual(
      italian.cards.map((card) => card.front).sort(),
    );
    for (const card of snapshot.cards) {
      expect(card.ownerId).toBe(viewer.user.id);
      expect(card.deckId).toBe(receipt.deckId);
      expect(card.aiGenerated).toBe(true);
      expect(card.schedule.phase).toBe('new');
      expect(card.schedule.totalReviews).toBe(0);
      expect(italian.cards.some((source) => source.id === card.id)).toBe(false);
    }
  });

  it('does not restore unpublished or removed content when migrations are retried', async () => {
    const source = catalog.decks.find((deck) => deck.slug === 'art-movements')!;
    await db.query(
      'UPDATE recollect.marketplace_listings SET is_published=false,show_download_count=true WHERE id=$1',
      [source.listingId],
    );
    await db.query('DELETE FROM recollect.marketplace_listings WHERE id=$1', [
      catalog.decks.find((deck) => deck.slug === 'music-fundamentals')!.listingId,
    ]);
    const before = (
      await db.query(`SELECT
      (SELECT count(*) FROM recollect.marketplace_listings)::int AS listings,
      (SELECT count(*) FROM recollect.cards)::int AS cards,
      (SELECT count(*) FROM recollect.changes)::int AS changes`)
    ).rows[0];
    await migrate(db);
    // Directly reapplying the approved SQL must also respect the migration receipt.
    await db.query(
      await readFile(
        new URL('../../../packages/db/migrations/0007_recollect_ai_catalog.sql', import.meta.url),
        'utf8',
      ),
    );
    const after = (
      await db.query(`SELECT
      (SELECT count(*) FROM recollect.marketplace_listings)::int AS listings,
      (SELECT count(*) FROM recollect.cards)::int AS cards,
      (SELECT count(*) FROM recollect.changes)::int AS changes`)
    ).rows[0];
    expect(after).toEqual(before);
    expect(
      (
        await db.query(
          'SELECT is_published,show_download_count FROM recollect.marketplace_listings WHERE id=$1',
          [source.listingId],
        )
      ).rows[0],
    ).toEqual({ is_published: false, show_download_count: true });
    expect(
      (
        await db.query(
          'SELECT count(*)::int AS count FROM recollect.marketplace_versions WHERE listing_id=$1',
          [source.listingId],
        )
      ).rows[0]?.count,
    ).toBe(1);
  });
});
