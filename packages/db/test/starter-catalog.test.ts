import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { cardSchema, deckSchema, marketplacePublishSchema } from '@recollect/contracts';
import { hash } from '../src/index.js';
import {
  buildStarterCatalog,
  loadStarterCatalog,
  RECOLLECT_AI_PUBLISHER_ID,
  renderStarterCatalogMigration,
  starterCatalogUuid,
  type StarterCatalogManifest,
} from '../src/starter-catalog.js';

const manifest = await loadStarterCatalog();
const build = buildStarterCatalog(manifest);

describe('reviewed Recollect AI starter catalog build', () => {
  it('builds valid, unreviewed AI cards and a publisher without login credentials', () => {
    expect(build.publisher).toEqual({
      id: RECOLLECT_AI_PUBLISHER_ID,
      name: 'Recollect AI',
      createdAt: manifest.createdAt,
    });
    expect(build.decks).toHaveLength(16);
    expect(build.decks.reduce((count, deck) => count + deck.cards.length, 0)).toBe(240);
    for (const entry of build.decks) {
      expect(deckSchema.parse(entry.deck)).toEqual(entry.deck);
      expect(entry.cards).toHaveLength(15);
      for (const card of entry.cards) {
        expect(cardSchema.parse(card)).toEqual(card);
        expect(card).toMatchObject({ ownerId: RECOLLECT_AI_PUBLISHER_ID, aiGenerated: true });
        expect(card.schedule).toMatchObject({
          phase: 'new',
          totalReviews: 0,
          repetitions: 0,
          lapses: 0,
          lastReviewedAt: null,
          dueAt: manifest.createdAt,
        });
      }
    }
  });

  it('keeps each deck summary first and every source available to learners', () => {
    for (const [index, entry] of build.decks.entries()) {
      const source = manifest.decks[index]!;
      expect(entry.deck.description.startsWith(source.description + '\n\nSources:\n')).toBe(true);
      for (const reference of source.sources) {
        expect(entry.deck.description).toContain(reference.title + ': ' + reference.url);
      }
    }
  });

  it('hashes the exact marketplace content and publication contract with metrics hidden', () => {
    for (const entry of build.decks) {
      expect(marketplacePublishSchema.parse(entry.publishRequest)).toEqual(entry.publishRequest);
      expect(entry.publishRequest).toMatchObject({
        deckId: entry.deck.id,
        rightsAccepted: true,
        showDownloadCount: false,
        showUsageStats: false,
        expectedContentHash: hash(entry.snapshot),
      });
      expect(entry.payloadHash).toBe(hash(entry.publishRequest));
      expect(entry.snapshot.cards.map((card) => card.id)).toEqual(
        entry.snapshot.cards.map((card) => card.id).sort(),
      );
      expect(entry.snapshot.cards[0]).not.toHaveProperty('ownerId');
      expect(entry.snapshot.cards[0]).not.toHaveProperty('schedule');
    }
  });

  it('assigns distinct UUIDv5 IDs across every entity role', () => {
    const ids = [
      RECOLLECT_AI_PUBLISHER_ID,
      ...build.decks.flatMap((entry) => [
        entry.deck.id,
        entry.listingId,
        entry.publishRequest.operationId,
        ...entry.cards.map((card) => card.id),
      ]),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids)
      expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(starterCatalogUuid('https://recollect-ai.netlify.app/publishers/recollect-ai')).toBe(
      RECOLLECT_AI_PUBLISHER_ID,
    );
  });

  it('keeps identities and publication hashes stable when catalog order changes', () => {
    const reordered = structuredClone(manifest);
    reordered.decks.reverse();
    for (const deck of reordered.decks) deck.cards.reverse();
    const rebuilt = buildStarterCatalog(reordered);
    for (const entry of build.decks) {
      const other = rebuilt.decks.find((candidate) => candidate.slug === entry.slug)!;
      expect(other.deck).toEqual(entry.deck);
      expect(other.snapshot).toEqual(entry.snapshot);
      expect(other.publishRequest).toEqual(entry.publishRequest);
      expect(other.payloadHash).toEqual(entry.payloadHash);
    }
  });

  it('rejects duplicate identities and incomplete or invalid content before SQL generation', () => {
    const invalid = (edit: (manifest: StarterCatalogManifest) => void) => {
      const changed = structuredClone(manifest);
      edit(changed);
      expect(() => buildStarterCatalog(changed)).toThrow();
    };
    invalid((m) => {
      m.decks[1]!.slug = m.decks[0]!.slug;
    });
    invalid((m) => {
      m.decks[0]!.cards[1]!.key = m.decks[0]!.cards[0]!.key;
    });
    invalid((m) => {
      m.decks[0]!.cards = [];
    });
    invalid((m) => {
      m.decks[0]!.sources = [];
    });
    invalid((m) => {
      m.decks[0]!.sources[0]!.url = 'http://example.test/source';
    });
    invalid((m) => {
      m.decks[0]!.sources[0]!.url = 'https://username:password@example.test/source';
    });
    invalid((m) => {
      m.decks[0]!.color = 'orange';
    });
    invalid((m) => {
      m.decks[0]!.cards[0]!.front = '';
    });
  });

  it('matches the immutable migration and confines mutation to new catalog records', async () => {
    const sql = renderStarterCatalogMigration(build);
    expect(sql).toBe(
      await readFile(
        new URL('../migrations/0007_recollect_ai_catalog.sql', import.meta.url),
        'utf8',
      ),
    );
    const statements = sql.slice(sql.indexOf('  PERFORM pg_advisory_xact_lock'));
    expect(statements).toContain("WHERE name='0007_recollect_ai_catalog.sql'");
    expect(statements).toContain('IF NOT existing_publisher.is_active THEN RETURN; END IF;');
    expect(statements).not.toMatch(/ON CONFLICT[^;]*DO UPDATE/i);
    expect(statements).not.toMatch(
      /INSERT INTO recollect\.(?:sessions|session_families|review_events|marketplace_downloads|import_batches)/i,
    );
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(statements.match(/\bUPDATE recollect\.\w+/g)).toEqual(['UPDATE recollect.sync_heads']);
  });

  it('rejects content that could terminate either SQL dollar-quoted block', () => {
    for (const delimiter of ['$recollect_ai_catalog_json$', '$recollect_ai_catalog$']) {
      const changed = structuredClone(manifest);
      changed.decks[0]!.description += delimiter;
      expect(() => renderStarterCatalogMigration(buildStarterCatalog(changed))).toThrow(
        'Reserved SQL delimiter',
      );
    }
  });
});
