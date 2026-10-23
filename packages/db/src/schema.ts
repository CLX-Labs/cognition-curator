import {
  bigint,
  boolean,
  foreignKey,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  date,
} from 'drizzle-orm/pg-core';
import type { Card, Deck, ReviewEvent, ScheduleState, SyncReceipt } from '@recollect/contracts';
export const recollect = pgSchema('recollect');
export const users = recollect.table('users', {
  id: uuid().primaryKey(),
  appleId: text('apple_id').unique(),
  email: text(),
  name: text().notNull(),
  profilePhotoDataUrl: text('profile_photo_data_url'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const authChallenges = recollect.table('auth_challenges', {
  id: uuid().primaryKey(),
  nonceHash: text('nonce_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
});
export const sessionFamilies = recollect.table('session_families', {
  id: uuid().primaryKey(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  authenticatedAt: timestamp('authenticated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const sessions = recollect.table('sessions', {
  id: uuid().primaryKey(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  familyId: uuid('family_id')
    .notNull()
    .references(() => sessionFamilies.id),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const syncHeads = recollect.table('sync_heads', {
  ownerId: uuid('owner_id')
    .primaryKey()
    .references(() => users.id),
  revision: bigint({ mode: 'bigint' }).notNull().default(0n),
});
export const decks = recollect.table(
  'decks',
  {
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    id: uuid().notNull().unique(),
    data: jsonb().$type<Deck>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.id] })],
);
export const cards = recollect.table(
  'cards',
  {
    ownerId: uuid('owner_id').notNull(),
    id: uuid().notNull().unique(),
    deckId: uuid('deck_id').notNull(),
    data: jsonb().$type<Card>().notNull(),
    checkpoint: jsonb().$type<ScheduleState>().notNull(),
    checkpointAt: timestamp('checkpoint_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.id] }),
    foreignKey({ columns: [t.ownerId, t.deckId], foreignColumns: [decks.ownerId, decks.id] }),
  ],
);
export const reviewEvents = recollect.table(
  'review_events',
  {
    ownerId: uuid('owner_id').notNull(),
    id: uuid().notNull(),
    cardId: uuid('card_id').notNull(),
    deviceId: text('device_id').notNull(),
    deviceSequence: bigint('device_sequence', { mode: 'number' }).notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull(),
    payloadHash: text('payload_hash').notNull(),
    data: jsonb().$type<ReviewEvent>().notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.id] }),
    unique().on(t.ownerId, t.deviceId, t.deviceSequence),
    foreignKey({ columns: [t.ownerId, t.cardId], foreignColumns: [cards.ownerId, cards.id] }),
  ],
);
export const operationReceipts = recollect.table(
  'operation_receipts',
  {
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    operationId: uuid('operation_id').notNull(),
    payloadHash: text('payload_hash').notNull(),
    result: jsonb().$type<SyncReceipt>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.operationId] })],
);
export const changes = recollect.table(
  'changes',
  {
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    revision: bigint({ mode: 'bigint' }).notNull(),
    ordinal: integer().notNull(),
    entity: text().notNull(),
    data: jsonb().notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.revision, t.ordinal] })],
);
export const generationJobs = recollect.table(
  'generation_jobs',
  {
    id: uuid().primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    deckId: uuid('deck_id').notNull(),
    operationId: uuid('operation_id').notNull(),
    payloadHash: text('payload_hash').notNull(),
    prompt: text().notNull(),
    cardCount: integer('card_count').notNull(),
    status: text().notNull(),
    attempt: integer().notNull().default(0),
    fence: uuid(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    candidates: jsonb().notNull().default([]),
    acceptedCandidateIds: jsonb('accepted_candidate_ids').notNull().default([]),
    error: jsonb(),
    usage: jsonb(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.ownerId, t.operationId),
    foreignKey({ columns: [t.ownerId, t.deckId], foreignColumns: [decks.ownerId, decks.id] }),
  ],
);
export const quotaBuckets = recollect.table(
  'quota_buckets',
  {
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    quotaDate: date('quota_date').notNull(),
    reserved: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.quotaDate] })],
);
export const acceptanceReceipts = recollect.table(
  'acceptance_receipts',
  {
    ownerId: uuid('owner_id').notNull(),
    operationId: uuid('operation_id').notNull(),
    payloadHash: text('payload_hash').notNull(),
    result: jsonb().notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.operationId] })],
);
export const importBatches = recollect.table(
  'import_batches',
  {
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    batchId: uuid('batch_id').notNull(),
    payloadHash: text('payload_hash').notNull(),
    source: text().notNull(),
    manifest: jsonb().notNull(),
    result: jsonb().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.batchId] })],
);
export const legacyArchives = recollect.table(
  'legacy_archives',
  {
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    data: jsonb().notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.sourceType, t.sourceId] })],
);
export const rateBuckets = recollect.table(
  'rate_buckets',
  {
    scope: text().notNull(),
    bucket: bigint({ mode: 'bigint' }).notNull(),
    count: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.bucket] })],
);

export const friendships = recollect.table(
  'friendships',
  {
    userA: uuid('user_a')
      .notNull()
      .references(() => users.id),
    userB: uuid('user_b')
      .notNull()
      .references(() => users.id),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    active: boolean().notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userA, t.userB] })],
);
export const friendInvites = recollect.table('friend_invites', {
  id: uuid().primaryKey(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  codeHash: text('code_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedBy: uuid('consumed_by').references(() => users.id),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const deckShares = recollect.table(
  'deck_shares',
  {
    id: uuid().primaryKey(),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id),
    operationId: uuid('operation_id').notNull(),
    payloadHash: text('payload_hash').notNull(),
    sourceDeckId: uuid('source_deck_id').notNull(),
    snapshot: jsonb().notNull(),
    sourceRevision: bigint('source_revision', { mode: 'bigint' }).notNull(),
    recipientDeckId: uuid('recipient_deck_id'),
    recipientRevision: bigint('recipient_revision', { mode: 'bigint' }),
    senderSharesProgress: boolean('sender_shares_progress').notNull().default(false),
    recipientSharesProgress: boolean('recipient_shares_progress').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [unique().on(t.senderId, t.operationId)],
);
export const sharedCardMappings = recollect.table(
  'shared_card_mappings',
  {
    shareId: uuid('share_id')
      .notNull()
      .references(() => deckShares.id, { onDelete: 'cascade' }),
    sourceCardId: uuid('source_card_id').notNull(),
    recipientCardId: uuid('recipient_card_id').notNull(),
    contentHash: text('content_hash').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.shareId, t.sourceCardId] }),
    unique().on(t.shareId, t.recipientCardId),
  ],
);
