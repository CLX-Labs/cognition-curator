import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REVIEW_CADENCE,
  categoryForDeck,
  defaultReviewSettingsInput,
  effectiveReviewCadence,
  legacyPushRequestSchema,
  legacyReviewEventSchema,
  legacySnapshotSchema,
  reviewCadenceSchema,
  reviewEventSchema,
  reviewSettingsInputSchema,
  reviewSettingsSchema,
  scheduledReviewEnabled,
  snapshotSchema,
  syncOperationSchema,
} from '../src/index.ts';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const owner = uuid(1);
const deck = uuid(2);
const categoryId = uuid(3);
const at = '2026-10-29T12:00:00.000Z';
const category = () => ({
  id: categoryId,
  name: '  Jeopardy trivia  ',
  color: '#AbeF12',
  reviewEnabled: true,
  cadence: null,
});
function settings() {
  return {
    ...defaultReviewSettingsInput(owner),
    categories: [category()],
    deckCategories: { [deck]: categoryId },
  };
}
const review = {
  id: uuid(5),
  cardId: uuid(6),
  deckId: deck,
  deviceId: uuid(7),
  deviceSequence: 1,
  rating: 'good',
  reviewedAt: at,
  elapsedMs: 20,
  algorithmVersion: 'sm2-v2',
};

describe('category and review settings contracts', () => {
  it('keeps existing defaults and returns independent mutable preferences', () => {
    const first = defaultReviewSettingsInput(owner);
    const second = defaultReviewSettingsInput(owner);
    expect(first).toEqual({
      id: owner,
      reviewEnabled: true,
      cadence: DEFAULT_REVIEW_CADENCE,
      categories: [],
      deckCategories: {},
    });
    first.cadence.goodDays = 9;
    expect(second.cadence.goodDays).toBe(7);
    expect(DEFAULT_REVIEW_CADENCE.goodDays).toBe(7);
    expect(scheduledReviewEnabled(undefined, deck)).toBe(true);
    expect(effectiveReviewCadence(undefined, deck)).toEqual(DEFAULT_REVIEW_CADENCE);
  });

  it('validates integer day bounds, strict fields, and ordering through the maximum', () => {
    expect(reviewCadenceSchema.parse(DEFAULT_REVIEW_CADENCE)).toEqual(DEFAULT_REVIEW_CADENCE);
    for (const patch of [
      { againDays: 0 },
      { hardDays: 1.5 },
      { goodDays: 3_651 },
      { againDays: 4 },
      { hardDays: 8 },
      { goodDays: 15 },
      { maxIntervalDays: 13 },
      { growIntervals: 'yes' },
      { minutes: 1 },
    ]) {
      expect(reviewCadenceSchema.safeParse({ ...DEFAULT_REVIEW_CADENCE, ...patch }).success).toBe(
        false,
      );
    }
  });

  it('trims names and rejects duplicate IDs, dangling assignments, and excess categories', () => {
    expect(reviewSettingsInputSchema.parse(settings()).categories[0]?.name).toBe('Jeopardy trivia');
    expect(
      reviewSettingsInputSchema.safeParse({ ...settings(), categories: [category(), category()] })
        .success,
    ).toBe(false);
    expect(reviewSettingsInputSchema.safeParse({ ...settings(), categories: [] }).success).toBe(
      false,
    );
    expect(
      reviewSettingsInputSchema.safeParse({
        ...settings(),
        categories: [{ ...category(), name: '  ' }],
      }).success,
    ).toBe(false);
    expect(
      reviewSettingsInputSchema.safeParse({
        ...settings(),
        categories: [{ ...category(), color: 'blue' }],
      }).success,
    ).toBe(false);
    expect(
      reviewSettingsInputSchema.safeParse({
        ...settings(),
        categories: Array.from({ length: 201 }, (_, n) => ({ ...category(), id: uuid(n + 100) })),
      }).success,
    ).toBe(false);
    const deckCategories = Object.fromEntries(
      Array.from({ length: 10_001 }, (_, n) => [uuid(n + 100), categoryId]),
    );
    expect(reviewSettingsInputSchema.safeParse({ ...settings(), deckCategories }).success).toBe(
      false,
    );
  });

  it('normalizes category UUIDs before uniqueness and reference checks', () => {
    const id = 'ABCDEFAB-0000-4000-8000-000000000001';
    const value = {
      ...settings(),
      categories: [{ ...category(), id }],
      deckCategories: { [deck]: id.toLowerCase() },
    };
    expect(reviewSettingsInputSchema.parse(value).categories[0]?.id).toBe(id.toLowerCase());
    expect(
      reviewSettingsInputSchema.safeParse({
        ...value,
        categories: [value.categories[0], { ...category(), id: id.toLowerCase() }],
      }).success,
    ).toBe(false);
  });

  it('inherits the global cadence, applies category overrides, and combines pause switches', () => {
    const value = reviewSettingsInputSchema.parse(settings());
    value.cadence.goodDays = 8;
    expect(categoryForDeck(value, deck)?.id).toBe(categoryId);
    expect(categoryForDeck(value, uuid(100))).toBeUndefined();
    expect(effectiveReviewCadence(value, deck).goodDays).toBe(8);
    value.categories[0]!.cadence = { ...DEFAULT_REVIEW_CADENCE, goodDays: 10 };
    const snapshot = effectiveReviewCadence(value, deck);
    expect(snapshot.goodDays).toBe(10);
    snapshot.goodDays = 12;
    expect(effectiveReviewCadence(value, deck).goodDays).toBe(10);
    expect(effectiveReviewCadence(value, uuid(100)).goodDays).toBe(8);
    value.categories[0]!.reviewEnabled = false;
    expect(scheduledReviewEnabled(value, deck)).toBe(false);
    expect(scheduledReviewEnabled(value, uuid(100))).toBe(true);
    value.reviewEnabled = false;
    expect(scheduledReviewEnabled(value, uuid(100))).toBe(false);
    value.categories[0]!.reviewEnabled = true;
    expect(scheduledReviewEnabled(value, deck)).toBe(false);
  });

  it('protects record ownership and rejects deletion in settings records', () => {
    const value = settings();
    expect(reviewSettingsInputSchema.safeParse({ ...value, ownerId: owner }).success).toBe(false);
    const record = {
      ...value,
      ownerId: owner,
      version: 1,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    };
    expect(reviewSettingsSchema.parse(record).ownerId).toBe(owner);
    expect(reviewSettingsSchema.safeParse({ ...record, deletedAt: at }).success).toBe(false);
    expect(reviewSettingsSchema.safeParse({ ...record, version: 0 }).success).toBe(false);
  });

  it('adds settings and cadence to v2 without admitting them into strict v1 requests', () => {
    const operation = {
      operationId: uuid(8),
      deviceId: review.deviceId,
      createdAt: at,
      type: 'reviewSettings.upsert',
      baseVersion: 0,
      payload: settings(),
    };
    expect(syncOperationSchema.parse(operation).type).toBe('reviewSettings.upsert');
    expect(legacyPushRequestSchema.safeParse({ operations: [operation] }).success).toBe(false);
    const modernReview = { ...review, cadence: DEFAULT_REVIEW_CADENCE };
    expect(reviewEventSchema.parse(modernReview).cadence).toEqual(DEFAULT_REVIEW_CADENCE);
    expect(legacyReviewEventSchema.safeParse(modernReview).success).toBe(false);
    expect(legacyReviewEventSchema.safeParse(review).success).toBe(true);
    const record = {
      ...settings(),
      ownerId: owner,
      version: 1,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    };
    const snapshot = {
      user: { id: owner, email: null, name: 'Nick' },
      cursor: '0',
      decks: [],
      cards: [],
      reviews: [modernReview],
      reviewSettings: record,
    };
    expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(legacySnapshotSchema.safeParse(snapshot).success).toBe(false);
    expect(
      snapshotSchema.safeParse({ ...snapshot, reviewSettings: undefined, reviews: [review] })
        .success,
    ).toBe(true);
  });
});
