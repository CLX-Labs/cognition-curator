import { z } from 'zod';

/** Wire format is deliberately explicit: UUIDs, UTC/offset ISO dates, seconds for intervals. */
export const uuidSchema = z.uuid().toLowerCase();
export const dateTimeSchema = z.iso.datetime({ offset: true });
export const revisionSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const ratingSchema = z.enum(['again', 'hard', 'good', 'easy']);
export type Rating = z.infer<typeof ratingSchema>;
export const LEGACY_ALGORITHM_VERSION = 'sm2-v1' as const;
export const ALGORITHM_VERSION = 'sm2-v2' as const;
export const algorithmVersionSchema = z.enum([LEGACY_ALGORITHM_VERSION, ALGORITHM_VERSION]);
export type AlgorithmVersion = z.infer<typeof algorithmVersionSchema>;

export const scheduleStateSchema = z.strictObject({
  algorithmVersion: algorithmVersionSchema,
  phase: z.enum(['new', 'learning', 'review', 'relearning']),
  dueAt: dateTimeSchema,
  // Legacy checkpoints may contain fractional/long intervals and ease above 3.
  // Preserve their current due date; the next new review applies scheduler bounds.
  intervalSeconds: z
    .number()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER / 1_000),
  easeFactor: z.number().min(1.3),
  learningStep: z.number().int().min(0).max(1),
  repetitions: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  lastReviewedAt: dateTimeSchema.nullable(),
  totalReviews: z.number().int().nonnegative(),
});
export type ScheduleState = z.infer<typeof scheduleStateSchema>;

export const userSchema = z.strictObject({
  id: uuidSchema,
  email: z.email().nullable(),
  name: z.string().min(1).max(100),
});
export type User = z.infer<typeof userSchema>;

// Small, normalized JPEGs stay private to the authenticated account. Keep this
// separate from sessionSchema so credentials never contain a photo payload.
export const MAX_PROFILE_PHOTO_LENGTH = 280_000;
export const profilePhotoSchema = z
  .string()
  .max(MAX_PROFILE_PHOTO_LENGTH)
  .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/);
export const profileSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().trim().min(1).max(100),
  photoDataUrl: profilePhotoSchema.nullable(),
});
export type Profile = z.infer<typeof profileSchema>;
export const profileUpdateSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(100).optional(),
    photoDataUrl: profilePhotoSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Choose a name or photo to update.',
  });
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;
export const sessionSchema = z.strictObject({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(32),
  expiresAt: dateTimeSchema,
  user: userSchema,
});
export type Session = z.infer<typeof sessionSchema>;

export const deckInputSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().max(10_000),
  color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
  icon: z.string().max(50),
  isSilenced: z.boolean(),
  silencedUntil: dateTimeSchema.nullable(),
});
export type DeckInput = z.infer<typeof deckInputSchema>;
const recordFields = {
  ownerId: uuidSchema,
  version: z.number().int().positive(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  deletedAt: dateTimeSchema.nullable(),
};
export const deckSchema = deckInputSchema.extend(recordFields);
export type Deck = z.infer<typeof deckSchema>;

export const cardInputSchema = z.strictObject({
  id: uuidSchema,
  deckId: uuidSchema,
  front: z.string().trim().min(1).max(20_000),
  back: z.string().trim().min(1).max(30_000),
  hint: z.string().max(10_000),
  explanation: z.string().max(30_000),
  tags: z.array(z.string().trim().min(1).max(100)).max(50),
  aiGenerated: z.boolean(),
});
export type CardInput = z.infer<typeof cardInputSchema>;
export const cardSchema = cardInputSchema.extend({
  ...recordFields,
  schedule: scheduleStateSchema,
});
export type Card = z.infer<typeof cardSchema>;

export const reviewEventSchema = z.strictObject({
  id: uuidSchema,
  cardId: uuidSchema,
  deckId: uuidSchema,
  deviceId: uuidSchema,
  deviceSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  rating: ratingSchema,
  reviewedAt: dateTimeSchema,
  elapsedMs: z.number().int().min(0).max(86_400_000),
  algorithmVersion: algorithmVersionSchema,
});
export type ReviewEvent = z.infer<typeof reviewEventSchema>;

const operationFields = {
  operationId: uuidSchema,
  deviceId: uuidSchema,
  createdAt: dateTimeSchema,
};
const baseVersion = z.number().int().nonnegative();
export const syncOperationSchema = z
  .discriminatedUnion('type', [
    z.strictObject({
      ...operationFields,
      type: z.literal('deck.upsert'),
      baseVersion,
      payload: deckInputSchema,
    }),
    z.strictObject({
      ...operationFields,
      type: z.literal('card.upsert'),
      baseVersion,
      payload: cardInputSchema,
    }),
    z.strictObject({
      ...operationFields,
      type: z.literal('deck.delete'),
      baseVersion,
      payload: z.strictObject({ id: uuidSchema }),
    }),
    z.strictObject({
      ...operationFields,
      type: z.literal('card.delete'),
      baseVersion,
      payload: z.strictObject({ id: uuidSchema }),
    }),
    z.strictObject({
      ...operationFields,
      type: z.literal('review.append'),
      payload: reviewEventSchema,
    }),
  ])
  .refine((op) => op.type !== 'review.append' || op.deviceId === op.payload.deviceId, {
    message: 'Operation and review must use the same device ID',
  });
export type SyncOperation = z.infer<typeof syncOperationSchema>;
export const pushRequestSchema = z.strictObject({
  operations: z.array(syncOperationSchema).min(1).max(100),
});
export type PushRequest = z.infer<typeof pushRequestSchema>;
export const errorSchema = z.strictObject({ code: z.string(), message: z.string() });
export const canonicalEntitySchema = z.discriminatedUnion('entity', [
  z.strictObject({ entity: z.literal('deck'), data: deckSchema }),
  z.strictObject({ entity: z.literal('card'), data: cardSchema }),
]);
export type CanonicalEntity = z.infer<typeof canonicalEntitySchema>;
export const syncReceiptSchema = z.strictObject({
  operationId: uuidSchema,
  status: z.enum(['accepted', 'duplicate', 'conflict', 'rejected']),
  revision: revisionSchema.optional(),
  canonical: canonicalEntitySchema.optional(),
  error: errorSchema.optional(),
});
export type SyncReceipt = z.infer<typeof syncReceiptSchema>;
export const pushResponseSchema = z.strictObject({ receipts: z.array(syncReceiptSchema) });
export type PushResponse = z.infer<typeof pushResponseSchema>;

export const syncChangeSchema = z.discriminatedUnion('entity', [
  z.strictObject({ revision: revisionSchema, entity: z.literal('deck'), data: deckSchema }),
  z.strictObject({ revision: revisionSchema, entity: z.literal('card'), data: cardSchema }),
  z.strictObject({
    revision: revisionSchema,
    entity: z.literal('review'),
    data: reviewEventSchema,
  }),
]);
export type SyncChange = z.infer<typeof syncChangeSchema>;
export const pullResponseSchema = z.strictObject({
  cursor: revisionSchema,
  highWatermark: revisionSchema,
  hasMore: z.boolean(),
  changes: z.array(syncChangeSchema),
});
export type PullResponse = z.infer<typeof pullResponseSchema>;
export const snapshotSchema = z.strictObject({
  user: userSchema,
  cursor: revisionSchema,
  decks: z.array(deckSchema),
  cards: z.array(cardSchema),
  reviews: z.array(reviewEventSchema),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export const appleChallengeSchema = z.strictObject({
  challengeId: uuidSchema,
  nonce: z.string().min(32).max(256),
  expiresAt: dateTimeSchema,
});
export type AppleChallenge = z.infer<typeof appleChallengeSchema>;
export const appleSignInSchema = z.strictObject({
  challengeId: uuidSchema,
  identityToken: z.string().min(1).max(20_000),
  displayName: z.string().trim().min(1).max(100).optional(),
});
export const refreshRequestSchema = z.strictObject({ refreshToken: z.string().min(32).max(500) });
export const generationRequestSchema = z.strictObject({
  operationId: uuidSchema,
  deckId: uuidSchema,
  prompt: z.string().trim().min(1).max(20_000),
  count: z.number().int().min(1).max(20),
});
export type GenerationRequest = z.infer<typeof generationRequestSchema>;
export const generationAcceptSchema = z.strictObject({
  operationId: uuidSchema,
  candidateIds: z.array(uuidSchema).min(1).max(20),
});
export const generationCandidateSchema = z.strictObject({
  id: uuidSchema,
  front: z.string().min(1).max(20_000),
  back: z.string().min(1).max(30_000),
  hint: z.string().max(10_000),
  explanation: z.string().max(30_000),
  tags: z.array(z.string().max(100)).max(50),
});
export type GenerationCandidate = z.infer<typeof generationCandidateSchema>;
export const generationJobSchema = z.strictObject({
  id: uuidSchema,
  deckId: uuidSchema,
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'canceled']),
  prompt: z.string(),
  count: z.number().int().min(1).max(20),
  candidates: z.array(generationCandidateSchema),
  error: errorSchema.nullable(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  acceptedCandidateIds: z.array(uuidSchema),
});
export type GenerationJob = z.infer<typeof generationJobSchema>;
export const generationAcceptResponseSchema = z.strictObject({
  cards: z.array(cardSchema),
  revision: revisionSchema,
});
export type GenerationAcceptResponse = z.infer<typeof generationAcceptResponseSchema>;

export const importCardSchema = cardInputSchema.extend({
  schedule: scheduleStateSchema,
  checkpointAt: dateTimeSchema,
});
export const importRequestSchema = z.strictObject({
  batchId: uuidSchema,
  source: z.enum(['swiftdata-v1', 'manual-recovery']),
  exportedAt: dateTimeSchema,
  sourceAccountId: uuidSchema.nullable(),
  ownershipConfirmed: z.boolean(),
  decks: z.array(deckInputSchema).max(10_000),
  cards: z.array(importCardSchema).max(100_000),
  archivedReviews: z.array(z.unknown()).max(500_000),
  rawManifest: z.unknown().optional(),
});
export type ImportRequest = z.infer<typeof importRequestSchema>;
export const importResponseSchema = z.strictObject({
  batchId: uuidSchema,
  revision: revisionSchema,
  importedDeckIds: z.array(uuidSchema),
  importedCardIds: z.array(uuidSchema),
  conflicts: z.array(
    z.strictObject({ entity: z.enum(['deck', 'card']), id: uuidSchema, reason: z.string() }),
  ),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ImportResponse = z.infer<typeof importResponseSchema>;

/** Never spread a server record into a command: ownership and schedule are server-owned. */
export function deckInput(deck: Deck | DeckInput): DeckInput {
  const { id, name, description, color, icon, isSilenced, silencedUntil } = deck;
  return { id, name, description, color, icon, isSilenced, silencedUntil };
}
export function cardInput(card: Card | CardInput): CardInput {
  const { id, deckId, front, back, hint, explanation, tags, aiGenerated } = card;
  return { id, deckId, front, back, hint, explanation, tags, aiGenerated };
}
