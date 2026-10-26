import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cardSchema,
  dateTimeSchema,
  deckSchema,
  marketplacePublishSchema,
  marketplaceSnapshotJson,
  marketplaceSnapshotValue,
  sharedCardSchema,
  sharedDeckSummarySchema,
  type Card,
  type Deck,
  type MarketplacePublish,
} from '@recollect/contracts';
import { initialSchedule } from '@recollect/scheduler';
import { hash } from './index.js';

const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
const CATALOG_URL = 'https://recollect-ai.netlify.app/catalog/recollect-ai-v1';
const MANIFEST_URL = new URL('../catalog/recollect-ai-v1.json', import.meta.url);
const MIGRATION_URL = new URL('../migrations/0007_recollect_ai_catalog.sql', import.meta.url);
const MIGRATION_NAME = '0007_recollect_ai_catalog.sql';

/** RFC 9562 UUIDv5: fixed URL namespace, UTF-8 name, SHA-1, and UUID version/variant bits. */
export function starterCatalogUuid(name: string): string {
  const namespace = Buffer.from(URL_NAMESPACE.replaceAll('-', ''), 'hex');
  const bytes = createHash('sha1').update(namespace).update(name, 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const RECOLLECT_AI_PUBLISHER_ID = starterCatalogUuid(
  'https://recollect-ai.netlify.app/publishers/recollect-ai',
);

export interface StarterCatalogManifest {
  version: 1;
  publisher: 'Recollect AI';
  createdAt: string;
  decks: {
    slug: string;
    title: string;
    description: string;
    color: string;
    icon: string;
    cards: {
      key: string;
      front: string;
      back: string;
      hint: string;
      explanation: string;
      tags: string[];
    }[];
    sources: { title: string; url: string }[];
  }[];
}

export interface StarterCatalogBuild {
  version: 1;
  createdAt: string;
  publisher: { id: string; name: 'Recollect AI'; createdAt: string };
  decks: {
    slug: string;
    deck: Deck;
    cards: Card[];
    listingId: string;
    snapshot: ReturnType<typeof marketplaceSnapshotValue>;
    publishRequest: MarketplacePublish;
    payloadHash: string;
  }[];
}

export async function loadStarterCatalog(): Promise<StarterCatalogManifest> {
  return JSON.parse(await readFile(MANIFEST_URL, 'utf8')) as StarterCatalogManifest;
}

function requireSlug(value: string): void {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
    throw new Error(`Invalid starter catalog key: ${String(value)}`);
}

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length)
    throw new Error(`Duplicate ${label} in starter catalog`);
}

/** Pure build: no clock, randomness, credentials, database, or network access. */
export function buildStarterCatalog(manifest: StarterCatalogManifest): StarterCatalogBuild {
  if (manifest.version !== 1 || manifest.publisher !== 'Recollect AI')
    throw new Error('Expected the Recollect AI v1 starter catalog');
  const createdAt = new Date(dateTimeSchema.parse(manifest.createdAt)).toISOString();
  if (!Array.isArray(manifest.decks) || !manifest.decks.length || manifest.decks.length > 100)
    throw new Error('The starter catalog must contain between 1 and 100 decks');
  unique(
    manifest.decks.map((deck) => deck.slug),
    'deck slug',
  );
  const publisher = { id: RECOLLECT_AI_PUBLISHER_ID, name: 'Recollect AI' as const, createdAt };
  const decks = manifest.decks.map((source) => {
    requireSlug(source.slug);
    if (!Array.isArray(source.cards) || !source.cards.length || source.cards.length > 1000)
      throw new Error(`Invalid starter card count for ${source.slug}`);
    unique(
      source.cards.map((card) => card.key),
      `card key in ${source.slug}`,
    );
    if (!Array.isArray(source.sources) || !source.sources.length)
      throw new Error(`Missing primary sources for ${source.slug}`);
    const references = source.sources.map((reference) => {
      const url = new URL(reference.url);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        typeof reference.title !== 'string' ||
        !reference.title.trim() ||
        /[\r\n]/.test(reference.title)
      )
        throw new Error(`Invalid primary source for ${source.slug}`);
      return `${reference.title.trim()}: ${reference.url}`;
    });
    if (typeof source.description !== 'string' || !source.description.trim())
      throw new Error(`Missing description for ${source.slug}`);
    const deck = deckSchema.parse({
      id: starterCatalogUuid(`${CATALOG_URL}/decks/${source.slug}`),
      ownerId: publisher.id,
      name: source.title,
      description: `${source.description.trim()}\n\nSources:\n${references.join('\n')}`,
      color: source.color,
      icon: source.icon,
      isSilenced: false,
      silencedUntil: null,
      version: 1,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    });
    const cards = source.cards.map((card) => {
      requireSlug(card.key);
      return cardSchema.parse({
        id: starterCatalogUuid(`${CATALOG_URL}/decks/${source.slug}/cards/${card.key}`),
        deckId: deck.id,
        ownerId: publisher.id,
        front: card.front,
        back: card.back,
        hint: card.hint,
        explanation: card.explanation,
        tags: card.tags,
        aiGenerated: true,
        schedule: initialSchedule(createdAt),
        version: 1,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      });
    });
    const summary = sharedDeckSummarySchema.parse({
      id: deck.id,
      name: deck.name,
      description: deck.description,
      color: deck.color,
      icon: deck.icon,
    });
    const sharedCards = cards.map((card) =>
      sharedCardSchema.parse({
        id: card.id,
        front: card.front,
        back: card.back,
        hint: card.hint,
        explanation: card.explanation,
        tags: card.tags,
        aiGenerated: card.aiGenerated,
      }),
    );
    const snapshot = marketplaceSnapshotValue(summary, sharedCards);
    if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > 2 * 1024 * 1024)
      throw new Error(`Starter deck ${source.slug} exceeds the marketplace snapshot limit`);
    const expectedContentHash = createHash('sha256')
      .update(marketplaceSnapshotJson(summary, sharedCards))
      .digest('hex');
    const publishRequest = marketplacePublishSchema.parse({
      operationId: starterCatalogUuid(`${CATALOG_URL}/publications/${source.slug}/1`),
      deckId: deck.id,
      rightsAccepted: true,
      expectedContentHash,
      showDownloadCount: false,
      showUsageStats: false,
    });
    return {
      slug: source.slug,
      deck,
      cards,
      listingId: starterCatalogUuid(`${CATALOG_URL}/listings/${source.slug}`),
      snapshot,
      publishRequest,
      payloadHash: hash(publishRequest),
    };
  });
  return { version: 1, createdAt, publisher, decks };
}

/** Generate once for review; apply only through migrate(), which records the ledger atomically. */
export function renderStarterCatalogMigration(build: StarterCatalogBuild): string {
  const delimiter = '$recollect_ai_catalog_json$';
  const payload = JSON.stringify(build);
  if (payload.includes(delimiter) || payload.includes('$recollect_ai_catalog$'))
    throw new Error('Reserved SQL delimiter in starter catalog');
  return `-- Generated by packages/db/src/starter-catalog.ts --write. Do not edit this published migration.
-- Apply through migrate(): the existing transaction and migration ledger make this additive seed atomic.
-- No authentication identity, sessions, reviews, downloads, or usage consent are created.
DO $recollect_ai_catalog$
DECLARE
  catalog jsonb := ${delimiter}${payload}${delimiter}::jsonb;
  publisher_id uuid := (catalog->'publisher'->>'id')::uuid;
  entry jsonb;
  card jsonb;
  existing_publisher record;
  revision_value bigint;
  ordinal_value integer := 0;
  has_new_decks boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('recollect.starter-catalog.v1'));
  -- Rerunning the SQL after a normal migration must not restore operator removals or settings.
  IF EXISTS (SELECT 1 FROM recollect.schema_migrations WHERE name='${MIGRATION_NAME}') THEN
    RETURN;
  END IF;
  -- This is the actual owner tombstone, without inventing an Apple identity for a system publisher.
  IF EXISTS (SELECT 1 FROM recollect.account_deletion_requests WHERE owner_id=publisher_id) THEN
    RETURN;
  END IF;
  SELECT * INTO existing_publisher FROM recollect.users WHERE id=publisher_id FOR UPDATE;
  IF FOUND THEN
    IF existing_publisher.apple_id IS NOT NULL OR existing_publisher.email IS NOT NULL
       OR existing_publisher.name IS DISTINCT FROM catalog->'publisher'->>'name' THEN
      RAISE EXCEPTION 'Recollect AI catalog publisher ID is already owned by another identity';
    END IF;
    IF NOT existing_publisher.is_active THEN RETURN; END IF;
    IF EXISTS (SELECT 1 FROM recollect.sessions WHERE owner_id=publisher_id)
       OR EXISTS (SELECT 1 FROM recollect.session_families WHERE owner_id=publisher_id) THEN
      RAISE EXCEPTION 'Recollect AI catalog publisher unexpectedly has authentication sessions';
    END IF;
  ELSE
    INSERT INTO recollect.users(id,apple_id,email,name,is_active,created_at)
    VALUES(publisher_id,NULL,NULL,catalog->'publisher'->>'name',true,(catalog->>'createdAt')::timestamptz);
  END IF;

  -- Check every globally unique ID before inserting anything. Never adopt another owner's rows.
  FOR entry IN SELECT value FROM jsonb_array_elements(catalog->'decks') LOOP
    IF EXISTS (
      SELECT 1 FROM recollect.decks d WHERE d.id=(entry->'deck'->>'id')::uuid
      AND (d.owner_id<>publisher_id OR d.data->>'ownerId' IS DISTINCT FROM publisher_id::text
        OR d.data->>'id' IS DISTINCT FROM entry->'deck'->>'id')
    ) THEN RAISE EXCEPTION 'Recollect AI catalog deck ID collision: %',entry->>'slug'; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(entry->'cards') c
      JOIN recollect.cards saved ON saved.id=(c->>'id')::uuid
      WHERE saved.owner_id<>publisher_id OR saved.deck_id<>(entry->'deck'->>'id')::uuid
        OR saved.data->>'ownerId' IS DISTINCT FROM publisher_id::text
        OR saved.data->>'deckId' IS DISTINCT FROM entry->'deck'->>'id'
        OR saved.data->>'id' IS DISTINCT FROM c->>'id'
    ) THEN RAISE EXCEPTION 'Recollect AI catalog card ID collision: %',entry->>'slug'; END IF;
    IF EXISTS (
      SELECT 1 FROM recollect.marketplace_listings l
      WHERE (l.id=(entry->>'listingId')::uuid
        AND (l.owner_id<>publisher_id OR l.source_deck_id<>(entry->'deck'->>'id')::uuid))
        OR (l.owner_id=publisher_id AND l.source_deck_id=(entry->'deck'->>'id')::uuid
          AND l.id<>(entry->>'listingId')::uuid)
    ) THEN RAISE EXCEPTION 'Recollect AI catalog listing ID collision: %',entry->>'slug'; END IF;
    IF EXISTS (
      SELECT 1 FROM recollect.marketplace_publish_operations p
      WHERE p.owner_id=publisher_id AND p.operation_id=(entry->'publishRequest'->>'operationId')::uuid
        AND (p.listing_id<>(entry->>'listingId')::uuid OR p.payload_hash<>entry->>'payloadHash')
    ) THEN RAISE EXCEPTION 'Recollect AI catalog publication ID collision: %',entry->>'slug'; END IF;
    IF NOT EXISTS (SELECT 1 FROM recollect.decks WHERE id=(entry->'deck'->>'id')::uuid)
       AND NOT EXISTS (SELECT 1 FROM recollect.marketplace_listings WHERE id=(entry->>'listingId')::uuid) THEN
      has_new_decks := true;
    END IF;
  END LOOP;
  IF NOT has_new_decks THEN RETURN; END IF;

  INSERT INTO recollect.sync_heads(owner_id) VALUES(publisher_id) ON CONFLICT DO NOTHING;
  SELECT revision+1 INTO revision_value FROM recollect.sync_heads WHERE owner_id=publisher_id FOR UPDATE;
  FOR entry IN SELECT value FROM jsonb_array_elements(catalog->'decks') LOOP
    -- Existing catalog rows belong to the operator. Do not refill, republish, or reset them.
    IF EXISTS (SELECT 1 FROM recollect.decks WHERE id=(entry->'deck'->>'id')::uuid)
       OR EXISTS (SELECT 1 FROM recollect.marketplace_listings WHERE id=(entry->>'listingId')::uuid) THEN
      CONTINUE;
    END IF;
    INSERT INTO recollect.decks(owner_id,id,data)
    VALUES(publisher_id,(entry->'deck'->>'id')::uuid,entry->'deck');
    INSERT INTO recollect.changes(owner_id,revision,ordinal,entity,data)
    VALUES(publisher_id,revision_value,ordinal_value,'deck',entry->'deck');
    ordinal_value := ordinal_value+1;
    FOR card IN SELECT value FROM jsonb_array_elements(entry->'cards') LOOP
      INSERT INTO recollect.cards(owner_id,id,deck_id,data,checkpoint,checkpoint_at)
      VALUES(publisher_id,(card->>'id')::uuid,(card->>'deckId')::uuid,card,card->'schedule',
        (catalog->>'createdAt')::timestamptz);
      INSERT INTO recollect.changes(owner_id,revision,ordinal,entity,data)
      VALUES(publisher_id,revision_value,ordinal_value,'card',card);
      ordinal_value := ordinal_value+1;
    END LOOP;
    INSERT INTO recollect.marketplace_listings(
      id,owner_id,source_deck_id,version,snapshot,is_published,show_download_count,show_usage_stats,published_at,updated_at)
    VALUES((entry->>'listingId')::uuid,publisher_id,(entry->'deck'->>'id')::uuid,1,entry->'snapshot',
      true,false,false,(catalog->>'createdAt')::timestamptz,(catalog->>'createdAt')::timestamptz);
    INSERT INTO recollect.marketplace_versions(listing_id,version,snapshot,source_revision,created_at)
    VALUES((entry->>'listingId')::uuid,1,entry->'snapshot',revision_value,(catalog->>'createdAt')::timestamptz);
    INSERT INTO recollect.marketplace_publish_operations(
      owner_id,operation_id,listing_id,version,payload_hash,rights_policy_version,accepted_at)
    VALUES(publisher_id,(entry->'publishRequest'->>'operationId')::uuid,(entry->>'listingId')::uuid,
      1,entry->>'payloadHash',1,(catalog->>'createdAt')::timestamptz);
  END LOOP;
  UPDATE recollect.sync_heads SET revision=revision_value WHERE owner_id=publisher_id;
END
$recollect_ai_catalog$;
`;
}

async function main(): Promise<void> {
  const [mode, ...extra] = process.argv.slice(2);
  if ((mode !== '--write' && mode !== '--check') || extra.length)
    throw new Error('Usage: tsx packages/db/src/starter-catalog.ts --write|--check');
  const build = buildStarterCatalog(await loadStarterCatalog());
  const sql = renderStarterCatalogMigration(build);
  if (mode === '--write') await writeFile(MIGRATION_URL, sql);
  else if ((await readFile(MIGRATION_URL, 'utf8')) !== sql)
    throw new Error(
      'The starter catalog migration differs from its reviewed manifest; regenerate before publishing.',
    );
  process.stdout.write(
    `${mode === '--write' ? 'Generated' : 'Checked'} ${MIGRATION_NAME}: ${build.decks.length} decks, ${build.decks.reduce((count, deck) => count + deck.cards.length, 0)} cards.\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
