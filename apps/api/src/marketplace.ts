import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  contentReportReceiptSchema,
  marketplaceCatalogSchema,
  marketplaceDetailSchema,
  marketplaceDownloadsSchema,
  marketplaceDownloadSchema,
  marketplaceListingSchema,
  marketplaceMineSchema,
  marketplacePublishSchema,
  marketplaceReportSchema,
  marketplaceSettingsSchema,
  marketplaceSnapshotValue,
  marketplaceUsagePermissionSchema,
  type Card,
  type Deck,
  type MarketplaceListing,
  type SharedCard,
  type SharedDeckSummary,
} from '@recollect/contracts';
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
import { initialSchedule } from '@recollect/scheduler';
import { assertShareableText, lockCommunityPair, requireUnblocked } from './community-safety.js';
import { assertDeckImage } from './deck-images.js';

type Snapshot = { deck: SharedDeckSummary; cards: SharedCard[] };
type ListingRow = {
  id: string;
  owner_id: string;
  source_deck_id: string;
  version: number;
  snapshot: Snapshot;
  is_published: boolean;
  show_download_count: boolean;
  show_usage_stats: boolean;
  published_at: Date;
  updated_at: Date;
};
type DownloadRow = {
  id: string;
  listing_id: string;
  recipient_id: string;
  recipient_deck_id: string;
  version: number;
  recipient_revision: string;
  consent_since: Date | null;
};
const querySchema = z.strictObject({
  query: z.string().trim().max(100).default(''),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const cursorSchema = z.strictObject({
  at: z.iso.datetime({ offset: true }),
  id: z.uuid().toLowerCase(),
});
function unavailable(): never {
  throw new DomainError('not_found', 'This marketplace deck is no longer available.', 404);
}
function content(card: SharedCard) {
  const { front, back, hint, explanation, tags, aiGenerated } = card;
  return { front, back, hint, explanation, tags, aiGenerated };
}
// Matching JSON values avoids locale/hash implementation differences in SQL.
function contentSql(alias: string) {
  return `jsonb_build_object('front',${alias}.data->'front','back',${alias}.data->'back',
    'hint',${alias}.data->'hint','explanation',${alias}.data->'explanation',
    'tags',${alias}.data->'tags','aiGenerated',${alias}.data->'aiGenerated')`;
}
function receipt(row: DownloadRow) {
  return marketplaceDownloadSchema.parse({
    listingId: row.listing_id,
    deckId: row.recipient_deck_id,
    version: row.version,
    contributeUsage: row.consent_since !== null,
  });
}
function band(value: number, limits: number[], labels: string[]) {
  return labels[limits.findIndex((limit) => value < limit)] ?? labels.at(-1)!;
}

export class MarketplaceService {
  constructor(private db: Database) {}

  private async throttle(owner: string, action: string, limit: number) {
    const row = (
      await this.db.query<{ count: number }>(
        `INSERT INTO recollect.rate_buckets(scope,bucket,count) VALUES($1,$2,1)
       ON CONFLICT(scope,bucket) DO UPDATE SET count=recollect.rate_buckets.count+1 RETURNING count`,
        ['marketplace:' + action + ':' + owner, Math.floor(Date.now() / 60_000)],
      )
    ).rows[0]!;
    if (row.count > limit)
      throw new DomainError('rate_limited', 'Too many requests; retry in a minute.', 429);
  }

  private async active(tx: Transaction, owner: string) {
    if (
      !(
        await tx.query('SELECT id FROM recollect.users WHERE id=$1 AND is_active=true FOR SHARE', [
          owner,
        ])
      ).rowCount
    )
      return unavailable();
  }

  /** Pair/user locks precede listing locks, which precede private-library locks. */
  private async locked(
    tx: Transaction,
    viewer: string,
    id: string,
    options: { owner?: boolean; allowUnavailable?: boolean } = {},
  ) {
    const initial = (
      await tx.query<ListingRow>('SELECT * FROM recollect.marketplace_listings WHERE id=$1', [id])
    ).rows[0];
    if (!initial || (options.owner && initial.owner_id !== viewer)) return unavailable();
    if (initial.owner_id === viewer) await this.active(tx, viewer);
    else {
      if (options.allowUnavailable) {
        // Revocation is allowed while the publisher awaits account erasure.
        // Preserve the same pair→sorted users→listing order as every writer.
        const ids = [viewer, initial.owner_id].sort();
        await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          'community-pair:' + ids.join(':'),
        ]);
        const users = (
          await tx.query<{ id: string; is_active: boolean }>(
            'SELECT id,is_active FROM recollect.users WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',
            [ids],
          )
        ).rows;
        if (users.length !== 2 || !users.find((user) => user.id === viewer)?.is_active)
          return unavailable();
      } else {
        await lockCommunityPair(tx, viewer, initial.owner_id);
        await requireUnblocked(tx, viewer, initial.owner_id);
      }
    }
    const row = (
      await tx.query<ListingRow>(
        'SELECT * FROM recollect.marketplace_listings WHERE id=$1 FOR UPDATE',
        [id],
      )
    ).rows[0];
    if (!row || (row.owner_id !== viewer && !row.is_published && !options.allowUnavailable))
      return unavailable();
    return row;
  }

  private async usage(tx: Transaction, listing: ListingRow) {
    if (!listing.show_usage_stats) return null;
    // Only post-consent reviews of never-materially-edited imported cards qualify.
    // Both reviewed_at and received_at are checked so offline/pre-consent history
    // cannot be backfilled by syncing it after consent. No sync analytics writes.
    const result = (
      await tx.query<{ learners: number; reviews: number; remembered: number }>(
        `SELECT count(DISTINCT d.recipient_id)::integer AS learners,count(*)::integer AS reviews,
       count(*) FILTER (WHERE r.data->>'rating' IN ('good','easy'))::integer AS remembered
       FROM recollect.marketplace_downloads d
       JOIN recollect.users u ON u.id=d.recipient_id AND u.is_active=true
       JOIN recollect.marketplace_card_mappings m ON m.download_id=d.id
       JOIN recollect.cards c ON c.owner_id=d.recipient_id AND c.id=m.recipient_card_id
       JOIN recollect.decks deck ON deck.owner_id=d.recipient_id AND deck.id=d.recipient_deck_id
       JOIN recollect.review_events r ON r.owner_id=d.recipient_id AND r.card_id=c.id
       WHERE d.listing_id=$1 AND d.consent_since IS NOT NULL
       AND c.deck_id=d.recipient_deck_id AND c.data->>'deletedAt' IS NULL AND deck.data->>'deletedAt' IS NULL
       AND ${contentSql('c')}=m.content
       AND r.reviewed_at>=GREATEST(d.consent_since,now()-interval '30 days')
       AND r.received_at>=d.consent_since AND r.reviewed_at<=now()
       AND NOT EXISTS (SELECT 1 FROM recollect.user_blocks b
         WHERE (b.blocker_id=$2 AND b.blocked_id=d.recipient_id) OR (b.blocker_id=d.recipient_id AND b.blocked_id=$2))
       AND NOT EXISTS (SELECT 1 FROM recollect.changes ch WHERE ch.owner_id=d.recipient_id
         AND ch.revision>d.recipient_revision AND ch.entity='card' AND ch.data->>'id'=m.recipient_card_id::text
         AND (ch.data->>'deckId'<>d.recipient_deck_id::text OR ch.data->>'deletedAt' IS NOT NULL OR ${contentSql('ch')}<>m.content))`,
        [listing.id, listing.owner_id],
      )
    ).rows[0]!;
    if (result.learners < 5 || !result.reviews) return null;
    return {
      learnerBand: band(
        result.learners,
        [10, 25, 50, 100],
        ['5–9', '10–24', '25–49', '50–99', '100+'],
      ),
      reviewBand: band(
        result.reviews,
        [10, 25, 50, 100, 250, 500],
        ['1–9', '10–24', '25–49', '50–99', '100–249', '250–499', '500+'],
      ),
      recallBand:
        result.remembered / result.reviews >= 0.7
          ? 'mostly_remembered'
          : (result.reviews - result.remembered) / result.reviews >= 0.7
            ? 'mostly_not_sure'
            : 'mixed',
      windowDays: 30,
    };
  }

  private async format(
    tx: Transaction,
    viewer: string,
    row: ListingRow,
  ): Promise<MarketplaceListing> {
    const publisher = (
      await tx.query<{ id: string; name: string }>(
        'SELECT id,name FROM recollect.users WHERE id=$1 AND is_active=true',
        [row.owner_id],
      )
    ).rows[0];
    if (!publisher) return unavailable();
    const ownDownload = (
      await tx.query<DownloadRow>(
        'SELECT * FROM recollect.marketplace_downloads WHERE recipient_id=$1 AND listing_id=$2',
        [viewer, row.id],
      )
    ).rows[0];
    let downloadCount: number | null = null;
    if (row.show_download_count)
      downloadCount = (
        await tx.query<{ count: number }>(
          `SELECT count(*)::integer AS count FROM recollect.marketplace_downloads d JOIN recollect.users u
       ON u.id=d.recipient_id AND u.is_active=true WHERE d.listing_id=$1 AND d.recipient_id<>$2`,
          [row.id, row.owner_id],
        )
      ).rows[0]!.count;
    const { id: _sourceId, ...deck } = row.snapshot.deck;
    return marketplaceListingSchema.parse({
      id: row.id,
      publisher,
      sourceDeckId: viewer === row.owner_id ? row.source_deck_id : null,
      deck,
      version: row.version,
      cardCount: row.snapshot.cards.length,
      isPublished: row.is_published,
      showDownloadCount: row.show_download_count,
      showUsageStats: row.show_usage_stats,
      downloadCount,
      usageStats: await this.usage(tx, row),
      publishedAt: row.published_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      download: ownDownload ? receipt(ownDownload) : null,
    });
  }

  async catalog(viewer: string, input: unknown) {
    const query = querySchema.parse(input);
    await this.throttle(viewer, 'catalog', 90);
    let cursor: z.infer<typeof cursorSchema> | null = null;
    if (query.cursor) {
      try {
        cursor = cursorSchema.parse(
          JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
        );
      } catch {
        throw new DomainError('invalid_cursor', 'Start a new marketplace search.');
      }
    }
    const rows = (
      await this.db.query<{ id: string; cursor_at: string }>(
        `SELECT l.id,to_char(l.published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
       FROM recollect.marketplace_listings l JOIN recollect.users u ON u.id=l.owner_id AND u.is_active=true
       WHERE l.is_published AND ($2='' OR strpos(lower(l.snapshot->'deck'->>'name'),lower($2))>0
        OR strpos(lower(l.snapshot->'deck'->>'description'),lower($2))>0)
       AND NOT EXISTS (SELECT 1 FROM recollect.user_blocks b
         WHERE (b.blocker_id=$1 AND b.blocked_id=l.owner_id) OR (b.blocker_id=l.owner_id AND b.blocked_id=$1))
       AND ($3::timestamptz IS NULL OR (l.published_at,l.id)<($3::timestamptz,$4::uuid))
       ORDER BY l.published_at DESC,l.id DESC LIMIT $5`,
        [viewer, query.query, cursor?.at ?? null, cursor?.id ?? null, query.limit + 1],
      )
    ).rows;
    const selected = rows.slice(0, query.limit),
      listings: MarketplaceListing[] = [];
    for (const item of selected) {
      try {
        listings.push((await this.detail(viewer, item.id, false)).listing);
      } catch (error) {
        if (!(error instanceof DomainError && error.statusCode === 404)) throw error;
      }
    }
    const last = selected.at(-1);
    return marketplaceCatalogSchema.parse({
      listings,
      nextCursor:
        rows.length > query.limit && last
          ? Buffer.from(JSON.stringify({ at: last.cursor_at, id: last.id })).toString('base64url')
          : null,
    });
  }

  async mine(owner: string) {
    const ids = (
      await this.db.query<{ id: string }>(
        'SELECT id FROM recollect.marketplace_listings WHERE owner_id=$1 ORDER BY updated_at DESC,id',
        [owner],
      )
    ).rows;
    const listings: MarketplaceListing[] = [];
    for (const { id } of ids) {
      try {
        listings.push((await this.detail(owner, id, false)).listing);
      } catch (error) {
        if (!(error instanceof DomainError && error.statusCode === 404)) throw error;
      }
    }
    return marketplaceMineSchema.parse({ listings });
  }

  async detail(viewer: string, id: string, throttle = true) {
    if (throttle) await this.throttle(viewer, 'detail', 90);
    return transaction(this.db, async (tx) => {
      const row = await this.locked(tx, viewer, id);
      return marketplaceDetailSchema.parse({
        listing: await this.format(tx, viewer, row),
        cards: row.snapshot.cards.slice(0, 5).map(content),
      });
    });
  }

  async publish(owner: string, input: unknown) {
    const request = marketplacePublishSchema.parse(input);
    await this.throttle(owner, 'publish', 10);
    return transaction(this.db, async (tx) => {
      // Serialize all publisher operations before looking up the source/listing.
      // This also prevents operation ID reuse racing across two different decks.
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'marketplace-publish:' + owner,
      ]);
      await this.active(tx, owner);
      const prior = (
        await tx.query<{ listing_id: string; payload_hash: string }>(
          'SELECT listing_id,payload_hash FROM recollect.marketplace_publish_operations WHERE owner_id=$1 AND operation_id=$2',
          [owner, request.operationId],
        )
      ).rows[0];
      const payloadHash = hash(request);
      if (prior) {
        if (prior.payload_hash !== payloadHash)
          throw new DomainError(
            'operation_id_reused',
            'Use a new operation ID for a different publication.',
            409,
          );
        const row = (
          await tx.query<ListingRow>(
            'SELECT * FROM recollect.marketplace_listings WHERE id=$1 FOR UPDATE',
            [prior.listing_id],
          )
        ).rows[0];
        if (!row) return unavailable();
        return this.format(tx, owner, row);
      }
      const existing = (
        await tx.query<ListingRow>(
          'SELECT * FROM recollect.marketplace_listings WHERE owner_id=$1 AND source_deck_id=$2 FOR UPDATE',
          [owner, request.deckId],
        )
      ).rows[0];
      if (
        !existing &&
        (
          await tx.query<{ count: number }>(
            'SELECT count(*)::integer AS count FROM recollect.marketplace_listings WHERE owner_id=$1',
            [owner],
          )
        ).rows[0]!.count >= 100
      )
        throw new DomainError('marketplace_limit', 'You can publish up to 100 marketplace decks.');
      const revision = await lockOwner(tx, owner);
      const deck = (
        await tx.query<{ data: Deck }>(
          `SELECT data FROM recollect.decks WHERE owner_id=$1 AND id=$2 AND data->>'deletedAt' IS NULL`,
          [owner, request.deckId],
        )
      ).rows[0]?.data;
      if (!deck) return unavailable();
      assertDeckImage(deck.imageDataUrl);
      const size = (
        await tx.query<{ count: number; bytes: string }>(
          `SELECT count(*)::integer AS count,COALESCE(sum(octet_length((jsonb_build_object('id',c.data->'id') || ${contentSql('c')})::text)),0)::text AS bytes
         FROM recollect.cards c WHERE c.owner_id=$1 AND c.deck_id=$2 AND c.data->>'deletedAt' IS NULL`,
          [owner, deck.id],
        )
      ).rows[0]!;
      if (!size.count)
        throw new DomainError('empty_deck', 'Add cards before publishing this deck.');
      if (size.count > 1000 || Number(size.bytes) > 2 * 1024 * 1024)
        throw new DomainError(
          'deck_too_large',
          'Publish up to 1,000 cards and 2 MiB of content. Split larger decks.',
        );
      const cards = (
        await tx.query<{ data: Card }>(
          `SELECT data FROM recollect.cards WHERE owner_id=$1 AND deck_id=$2 AND data->>'deletedAt' IS NULL ORDER BY id LIMIT 1001`,
          [owner, deck.id],
        )
      ).rows.map(({ data }) => ({ id: data.id, ...content(data) }));
      if (!cards.length)
        throw new DomainError('empty_deck', 'Add cards before publishing this deck.');
      if (cards.length > 1000)
        throw new DomainError('deck_too_large', 'Publish a deck with at most 1,000 cards.');
      const snapshot: Snapshot = {
        deck: {
          id: deck.id,
          name: deck.name,
          description: deck.description,
          color: deck.color,
          icon: deck.icon,
          ...(deck.imageDataUrl !== undefined ? { imageDataUrl: deck.imageDataUrl } : {}),
        },
        cards,
      };
      if (
        hash(marketplaceSnapshotValue(snapshot.deck, snapshot.cards)) !==
        request.expectedContentHash
      )
        throw new DomainError(
          'publication_changed',
          'This deck changed since you reviewed it. Sync, review the current cards, and publish again.',
          409,
        );
      if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > 2 * 1024 * 1024)
        throw new DomainError(
          'deck_too_large',
          'Publish a deck smaller than 2 MiB. Shorten long cards or split the deck.',
        );
      const publisher = (
        await tx.query<{ name: string }>('SELECT name FROM recollect.users WHERE id=$1', [owner])
      ).rows[0]!;
      assertShareableText(
        [
          publisher.name,
          deck.name,
          deck.description,
          deck.icon,
          ...cards.flatMap((card) => [
            card.front,
            card.back,
            card.hint,
            card.explanation,
            ...card.tags,
          ]),
        ].join('\n'),
      );
      const version = (existing?.version ?? 0) + 1,
        id = existing?.id ?? randomUUID();
      const row = (
        await tx.query<ListingRow>(
          `INSERT INTO recollect.marketplace_listings(id,owner_id,source_deck_id,version,snapshot,show_download_count,show_usage_stats)
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(owner_id,source_deck_id) DO UPDATE SET version=$4,snapshot=$5,
         is_published=true,show_download_count=$6,show_usage_stats=$7,updated_at=now() RETURNING *`,
          [
            id,
            owner,
            deck.id,
            version,
            snapshot,
            request.showDownloadCount,
            request.showUsageStats,
          ],
        )
      ).rows[0]!;
      await tx.query(
        'INSERT INTO recollect.marketplace_versions(listing_id,version,snapshot,source_revision) VALUES($1,$2,$3,$4)',
        [id, version, snapshot, revision.toString()],
      );
      await tx.query(
        'INSERT INTO recollect.marketplace_publish_operations(owner_id,operation_id,listing_id,version,payload_hash) VALUES($1,$2,$3,$4,$5)',
        [owner, request.operationId, id, version, payloadHash],
      );
      return this.format(tx, owner, row);
    });
  }

  async settings(owner: string, id: string, input: unknown) {
    const request = marketplaceSettingsSchema.parse(input);
    return transaction(this.db, async (tx) => {
      await this.locked(tx, owner, id, { owner: true });
      const row = (
        await tx.query<ListingRow>(
          `UPDATE recollect.marketplace_listings SET is_published=COALESCE($2,is_published),
        show_download_count=COALESCE($3,show_download_count),show_usage_stats=COALESCE($4,show_usage_stats),updated_at=now() WHERE id=$1 RETURNING *`,
          [
            id,
            request.isPublished ?? null,
            request.showDownloadCount ?? null,
            request.showUsageStats ?? null,
          ],
        )
      ).rows[0]!;
      return this.format(tx, owner, row);
    });
  }

  async download(owner: string, id: string) {
    await this.throttle(owner, 'download', 20);
    return transaction(this.db, async (tx) => {
      const row = await this.locked(tx, owner, id);
      if (row.owner_id === owner)
        throw new DomainError(
          'own_marketplace_deck',
          'Your original deck is already in your library.',
        );
      const existing = (
        await tx.query<DownloadRow>(
          'SELECT * FROM recollect.marketplace_downloads WHERE recipient_id=$1 AND listing_id=$2',
          [owner, id],
        )
      ).rows[0];
      if (existing) return receipt(existing);
      await lockOwner(tx, owner);
      const now = new Date().toISOString(),
        downloadId = randomUUID();
      const deck: Deck = {
        ...row.snapshot.deck,
        id: randomUUID(),
        ownerId: owner,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        isSilenced: false,
        silencedUntil: null,
      };
      await tx.query('INSERT INTO recollect.decks(owner_id,id,data) VALUES($1,$2,$3)', [
        owner,
        deck.id,
        deck,
      ]);
      const changes: Change[] = [{ entity: 'deck', data: deck }],
        mappings: { source: SharedCard; card: Card }[] = [];
      for (const source of row.snapshot.cards) {
        const card: Card = {
          ...source,
          id: randomUUID(),
          deckId: deck.id,
          ownerId: owner,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          schedule: initialSchedule(now),
        };
        await tx.query(
          'INSERT INTO recollect.cards(owner_id,id,deck_id,data,checkpoint,checkpoint_at) VALUES($1,$2,$3,$4,$5,$6)',
          [owner, card.id, deck.id, card, card.schedule, now],
        );
        changes.push({ entity: 'card', data: card });
        mappings.push({ source, card });
      }
      const revision = await appendChanges(tx, owner, changes);
      const imported = (
        await tx.query<DownloadRow>(
          `INSERT INTO recollect.marketplace_downloads(id,listing_id,recipient_id,recipient_deck_id,version,recipient_revision)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
          [downloadId, id, owner, deck.id, row.version, revision],
        )
      ).rows[0]!;
      for (const { source, card } of mappings)
        await tx.query(
          `INSERT INTO recollect.marketplace_card_mappings(download_id,source_card_id,recipient_card_id,content_hash,content) VALUES($1,$2,$3,$4,$5)`,
          [downloadId, source.id, card.id, hash(content(source)), content(source)],
        );
      return receipt(imported);
    });
  }

  async downloads(owner: string) {
    return marketplaceDownloadsSchema.parse({
      downloads: (
        await this.db.query<DownloadRow>(
          'SELECT * FROM recollect.marketplace_downloads WHERE recipient_id=$1 ORDER BY created_at DESC,id',
          [owner],
        )
      ).rows.map(receipt),
    });
  }

  async setUsage(owner: string, id: string, input: unknown) {
    const { enabled } = marketplaceUsagePermissionSchema.parse(input);
    return transaction(this.db, async (tx) => {
      await this.locked(tx, owner, id, { allowUnavailable: !enabled });
      if (enabled) await lockOwner(tx, owner);
      const row = (
        await tx.query<DownloadRow>(
          'SELECT * FROM recollect.marketplace_downloads WHERE recipient_id=$1 AND listing_id=$2 FOR UPDATE',
          [owner, id],
        )
      ).rows[0];
      if (!row) return unavailable();
      if (
        enabled &&
        !(
          await tx.query(
            `SELECT 1 FROM recollect.decks WHERE owner_id=$1 AND id=$2 AND data->>'deletedAt' IS NULL`,
            [owner, row.recipient_deck_id],
          )
        ).rowCount
      )
        throw new DomainError(
          'marketplace_copy_removed',
          'This downloaded copy was removed. Usage contribution cannot be enabled.',
          409,
        );
      const updated = (
        await tx.query<DownloadRow>(
          `UPDATE recollect.marketplace_downloads SET consent_since=CASE WHEN $3 THEN COALESCE(consent_since,clock_timestamp()) ELSE NULL END
        WHERE recipient_id=$1 AND listing_id=$2 RETURNING *`,
          [owner, id, enabled],
        )
      ).rows[0]!;
      return receipt(updated);
    });
  }

  async report(owner: string, id: string, input: unknown) {
    const request = marketplaceReportSchema.parse(input);
    await this.throttle(owner, 'report', 10);
    return transaction(this.db, async (tx) => {
      const row = await this.locked(tx, owner, id);
      if (row.owner_id === owner) return unavailable();
      const reportId = randomUUID();
      const stored = (
        await tx.query<{ created_at: Date }>(
          `INSERT INTO recollect.marketplace_reports(id,listing_id,reporter_id,target_user_id,version,reason,details,evidence)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING created_at`,
          [
            reportId,
            id,
            owner,
            row.owner_id,
            row.version,
            request.reason,
            request.details ?? '',
            row.snapshot,
          ],
        )
      ).rows[0]!;
      return contentReportReceiptSchema.parse({
        id: reportId,
        createdAt: stored.created_at.toISOString(),
      });
    });
  }

  async blockPublisher(owner: string, id: string) {
    await transaction(this.db, async (tx) => {
      const row = await this.locked(tx, owner, id);
      if (row.owner_id === owner) return unavailable();
      await tx.query(
        'INSERT INTO recollect.user_blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [owner, row.owner_id],
      );
      await tx.query(
        `UPDATE recollect.marketplace_downloads d SET consent_since=NULL FROM recollect.marketplace_listings l
        WHERE d.listing_id=l.id AND ((d.recipient_id=$1 AND l.owner_id=$2) OR (d.recipient_id=$2 AND l.owner_id=$1))`,
        [owner, row.owner_id],
      );
      await tx.query(
        'UPDATE recollect.friendships SET active=false WHERE user_a=LEAST($1::uuid,$2::uuid) AND user_b=GREATEST($1::uuid,$2::uuid)',
        [owner, row.owner_id],
      );
      await tx.query(
        `UPDATE recollect.deck_shares SET revoked_at=COALESCE(revoked_at,now()),sender_shares_progress=false,recipient_shares_progress=false
        WHERE (sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1)`,
        [owner, row.owner_id],
      );
    });
  }
}
