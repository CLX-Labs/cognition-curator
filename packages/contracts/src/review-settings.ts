import { z } from 'zod';
import { recordFields, uuidSchema } from './record-fields.ts';

const cadenceDays = z.number().int().min(1).max(3_650);
export const reviewCadenceSchema = z
  .strictObject({
    againDays: cadenceDays,
    hardDays: cadenceDays,
    goodDays: cadenceDays,
    easyDays: cadenceDays,
    maxIntervalDays: cadenceDays,
    growIntervals: z.boolean(),
  })
  .refine(
    (cadence) =>
      cadence.againDays <= cadence.hardDays &&
      cadence.hardDays <= cadence.goodDays &&
      cadence.goodDays <= cadence.easyDays &&
      cadence.easyDays <= cadence.maxIntervalDays,
    {
      message: 'Review intervals must increase from Again through Easy and stay below the maximum.',
    },
  );
export type ReviewCadence = z.infer<typeof reviewCadenceSchema>;

export const DEFAULT_REVIEW_CADENCE: ReviewCadence = Object.freeze({
  againDays: 3,
  hardDays: 3,
  goodDays: 7,
  easyDays: 14,
  maxIntervalDays: 3_650,
  growIntervals: true,
});

export const categorySchema = z.strictObject({
  id: uuidSchema,
  name: z.string().trim().min(1).max(100),
  color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
  reviewEnabled: z.boolean(),
  cadence: reviewCadenceSchema.nullable(),
});
export type Category = z.infer<typeof categorySchema>;

export const reviewSettingsInputSchema = z
  .strictObject({
    id: uuidSchema,
    reviewEnabled: z.boolean(),
    cadence: reviewCadenceSchema,
    categories: z.array(categorySchema).max(200),
    deckCategories: z.record(uuidSchema, uuidSchema),
  })
  .superRefine((settings, context) => {
    const categoryIds = new Set(settings.categories.map((category) => category.id));
    if (categoryIds.size !== settings.categories.length) {
      context.addIssue({
        code: 'custom',
        path: ['categories'],
        message: 'Each category must have a unique ID.',
      });
    }
    if (Object.keys(settings.deckCategories).length > 10_000) {
      context.addIssue({
        code: 'custom',
        path: ['deckCategories'],
        message: 'A maximum of 10,000 decks can be assigned to categories.',
      });
    }
    for (const [deckId, categoryId] of Object.entries(settings.deckCategories)) {
      if (!categoryIds.has(categoryId)) {
        context.addIssue({
          code: 'custom',
          path: ['deckCategories', deckId],
          message: 'Choose an existing category for this deck.',
        });
      }
    }
  });
export type ReviewSettingsInput = z.infer<typeof reviewSettingsInputSchema>;
export const reviewSettingsSchema = reviewSettingsInputSchema.safeExtend({
  ...recordFields,
  deletedAt: z.null(),
});
export type ReviewSettings = z.infer<typeof reviewSettingsSchema>;

/** One settings record per owner. Defaults preserve review behavior before categories. */
export function defaultReviewSettingsInput(ownerId: string): ReviewSettingsInput {
  return {
    id: uuidSchema.parse(ownerId),
    reviewEnabled: true,
    cadence: { ...DEFAULT_REVIEW_CADENCE },
    categories: [],
    deckCategories: {},
  };
}

type Settings = ReviewSettingsInput | null | undefined;
export function categoryForDeck(settings: Settings, deckId: string): Category | undefined {
  const categoryId = settings?.deckCategories[deckId];
  return categoryId
    ? settings?.categories.find((category) => category.id === categoryId)
    : undefined;
}

/** Capture this value in a review event so later preference changes cannot rewrite history. */
export function effectiveReviewCadence(settings: Settings, deckId: string): ReviewCadence {
  return {
    ...(categoryForDeck(settings, deckId)?.cadence ?? settings?.cadence ?? DEFAULT_REVIEW_CADENCE),
  };
}

export function scheduledReviewEnabled(settings: Settings, deckId: string): boolean {
  return (
    (settings?.reviewEnabled ?? true) && (categoryForDeck(settings, deckId)?.reviewEnabled ?? true)
  );
}
