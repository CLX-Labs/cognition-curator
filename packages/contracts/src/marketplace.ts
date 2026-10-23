import { z } from 'zod';
import {
  sharedCardSchema,
  sharedDeckSummarySchema,
  type SharedCard,
  type SharedDeckSummary,
} from './community.ts';

/** Content that the creator actually reviewed, independent of sync/review metadata. */
export function marketplaceSnapshotValue(deck: SharedDeckSummary, cards: readonly SharedCard[]) {
  return {
    deck: {
      id: deck.id,
      name: deck.name,
      description: deck.description,
      color: deck.color,
      icon: deck.icon,
    },
    cards: cards
      .map((card) => ({
        id: card.id,
        front: card.front,
        back: card.back,
        hint: card.hint,
        explanation: card.explanation,
        tags: card.tags,
        aiGenerated: card.aiGenerated,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => JSON.stringify(key) + ':' + canonicalJson(entry))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}

/** SHA-256 this UTF-8 string on the client; the server uses the same canonical value. */
export function marketplaceSnapshotJson(deck: SharedDeckSummary, cards: readonly SharedCard[]) {
  return canonicalJson(marketplaceSnapshotValue(deck, cards));
}

const uuid = z.uuid().toLowerCase();
const timestamp = z.iso.datetime({ offset: true });
export const marketplaceDownloadSchema = z.strictObject({
  listingId: uuid,
  deckId: uuid,
  version: z.number().int().positive(),
  contributeUsage: z.boolean(),
});
export type MarketplaceDownload = z.infer<typeof marketplaceDownloadSchema>;
export const marketplaceUsageSchema = z.strictObject({
  learnerBand: z.enum(['5–9', '10–24', '25–49', '50–99', '100+']),
  reviewBand: z.enum(['1–9', '10–24', '25–49', '50–99', '100–249', '250–499', '500+']),
  recallBand: z.enum(['mostly_remembered', 'mixed', 'mostly_not_sure']),
  windowDays: z.literal(30),
});
export const marketplaceListingSchema = z.strictObject({
  id: uuid,
  publisher: z.strictObject({ id: uuid, name: z.string().min(1).max(100) }),
  sourceDeckId: uuid.nullable(),
  deck: sharedDeckSummarySchema.omit({ id: true }),
  version: z.number().int().positive(),
  cardCount: z.number().int().min(1).max(1000),
  isPublished: z.boolean(),
  showDownloadCount: z.boolean(),
  showUsageStats: z.boolean(),
  downloadCount: z.number().int().nonnegative().nullable(),
  usageStats: marketplaceUsageSchema.nullable(),
  publishedAt: timestamp,
  updatedAt: timestamp,
  download: marketplaceDownloadSchema.nullable(),
});
export type MarketplaceListing = z.infer<typeof marketplaceListingSchema>;
export const marketplaceCatalogSchema = z.strictObject({
  listings: z.array(marketplaceListingSchema).max(50),
  nextCursor: z.string().max(300).nullable(),
});
export type MarketplaceCatalog = z.infer<typeof marketplaceCatalogSchema>;
export const marketplaceMineSchema = z.strictObject({
  listings: z.array(marketplaceListingSchema),
});
export const marketplaceDownloadsSchema = z.strictObject({
  downloads: z.array(marketplaceDownloadSchema),
});
export const marketplaceDetailSchema = z.strictObject({
  listing: marketplaceListingSchema,
  cards: z.array(sharedCardSchema.omit({ id: true })).max(5),
});
export type MarketplaceDetail = z.infer<typeof marketplaceDetailSchema>;
export const marketplacePublishSchema = z.strictObject({
  operationId: uuid,
  deckId: uuid,
  rightsAccepted: z.literal(true),
  expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  showDownloadCount: z.boolean().default(false),
  showUsageStats: z.boolean().default(false),
});
export type MarketplacePublish = z.infer<typeof marketplacePublishSchema>;
export const marketplaceSettingsSchema = z
  .strictObject({
    isPublished: z.boolean().optional(),
    showDownloadCount: z.boolean().optional(),
    showUsageStats: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0);
export type MarketplaceSettings = z.infer<typeof marketplaceSettingsSchema>;
export const marketplaceUsagePermissionSchema = z.strictObject({ enabled: z.boolean() });
export const marketplaceReportSchema = z.strictObject({
  reason: z.enum(['inappropriate', 'harassment', 'spam', 'other']),
  details: z.string().trim().max(2000).optional(),
});
