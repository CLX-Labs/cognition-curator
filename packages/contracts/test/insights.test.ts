import { describe, expect, it } from 'vitest';
import {
  buildRecallInsights,
  recallInsightsSchema,
  type InsightCard,
  type ReviewEvent,
} from '../src/index.ts';

const uuid = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
const deckId = uuid(100);
const card: InsightCard = {
  id: uuid(1),
  deckId,
  deckName: 'Italian',
  front: 'Ciao',
  back: 'Hello',
};
const now = '2026-10-22T12:00:00.000Z';
function event(
  index: number,
  rating: ReviewEvent['rating'],
  at = now,
  patch: Partial<ReviewEvent> = {},
) {
  return {
    id: uuid(1_000 + index),
    cardId: card.id,
    deckId,
    deviceId: uuid(500),
    deviceSequence: index,
    rating,
    reviewedAt: at,
    elapsedMs: 2_000,
    algorithmVersion: 'sm2-v2',
    ...patch,
  } satisfies ReviewEvent;
}

describe('recorded recall insights', () => {
  it('keeps zero-history cards unreviewed and rates unknown instead of inferring imported schedules', () => {
    const insights = buildRecallInsights({ cards: [card], reviews: [], days: 7, now });
    expect(recallInsightsSchema.safeParse(insights).success).toBe(true);
    expect(insights.summary).toMatchObject({
      cardCount: 1,
      reviewedCardCount: 0,
      unreviewedCardCount: 1,
      reviewCount: 0,
      recallRate: null,
      activeDays: 0,
      lastReviewedAt: null,
      trend: { direction: 'insufficient', changePoints: null },
    });
    expect(insights.cards[0]).toMatchObject({
      reviewCount: 0,
      history: [],
      historyTotal: 0,
      historyTruncated: false,
      consistentRemembered: false,
      repeatUnsure: false,
    });
    expect(insights.daily).toHaveLength(7);
    expect(insights.daily.every((day) => day.recallRate === null)).toBe(true);
    expect(buildRecallInsights({ cards: [], reviews: [], days: null, now }).daily).toEqual([]);
  });

  it('excludes inactive or mismatched cards, future events and duplicate IDs/device sequences', () => {
    const recorded = event(1, 'good');
    const reviews = [
      recorded,
      { ...recorded },
      event(2, 'again', now, { deviceSequence: 1 }),
      event(3, 'again', now, { cardId: uuid(2) }),
      event(4, 'again', now, { deckId: uuid(101) }),
      event(5, 'again', now, { cardId: uuid(3) }),
      event(6, 'again', '2026-10-22T12:00:00.001Z'),
    ];
    const insights = buildRecallInsights({
      cards: [card, { ...card }, { ...card, id: uuid(2), deletedAt: now }],
      reviews,
      days: null,
      now,
    });
    expect(insights.summary).toMatchObject({ cardCount: 1, reviewCount: 1, recallRate: 100 });
    expect(insights.cards[0]!.history.map((entry) => entry.id)).toEqual([recorded.id]);
    expect(
      buildRecallInsights({ cards: [card], reviews: [...reviews].reverse(), days: null, now }),
    ).toEqual(buildRecallInsights({ cards: [card], reviews, days: null, now }));
  });

  it('uses local calendar windows at DST boundaries and includes the exact beginning and now', () => {
    const insights = buildRecallInsights({
      cards: [card],
      reviews: [
        event(1, 'again', '2026-10-29T03:59:59.999Z'),
        event(2, 'good', '2026-10-29T04:00:00.000Z'),
        event(3, 'good', '2026-11-01T05:30:00.000Z'),
        event(4, 'hard', '2026-11-01T06:30:00.000Z'),
        event(5, 'easy', '2026-11-04T12:00:00.000Z'),
      ],
      days: 7,
      now: '2026-11-04T12:00:00.000Z',
      timezone: 'America/New_York',
    });
    expect(insights.window.since).toBe('2026-10-29T04:00:00.000Z');
    expect(insights.summary).toMatchObject({ reviewCount: 4, activeDays: 3, recallRate: 75 });
    expect(insights.daily.map((day) => day.date)).toEqual([
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
    ]);
    expect(insights.daily.find((day) => day.date === '2026-11-01')).toMatchObject({
      reviewCount: 2,
      recallRate: 50,
    });
    expect(insights.weekly.map((week) => [week.weekStart, week.reviewCount])).toEqual([
      ['2026-10-26', 3],
      ['2026-11-02', 1],
    ]);
  });

  it.each([7, 30, 90] as const)(
    'bounds a %i-day selection without losing older comparison history',
    (days) => {
      const start = new Date('2026-10-22T00:00:00.000Z');
      start.setUTCDate(start.getUTCDate() - days + 1);
      const boundary = start.toISOString();
      const before = new Date(start.getTime() - 1).toISOString();
      const insights = buildRecallInsights({
        cards: [card],
        reviews: [event(1, 'again', before), event(2, 'good', boundary)],
        days,
        now,
      });
      expect(insights.window.since).toBe(boundary);
      expect(insights.summary.reviewCount).toBe(1);
      expect(insights.summary.trend.previousReviewCount).toBe(1);
      expect(insights.daily).toHaveLength(days);
      expect(insights.cards[0]!.historyTotal).toBe(1);
    },
  );

  it('groups good/easy as remembered and again/hard as unsure, with evidence-based card patterns', () => {
    const second = { ...card, id: uuid(2), front: 'Grazie' };
    const third = { ...card, id: uuid(3), front: 'Prego' };
    const reviews = [
      event(1, 'again'),
      event(2, 'hard'),
      event(3, 'good'),
      event(4, 'good', now, { cardId: second.id }),
      event(5, 'easy', now, { cardId: second.id }),
      event(6, 'good', now, { cardId: second.id }),
      event(7, 'again', now, { cardId: third.id }),
    ];
    const insights = buildRecallInsights({ cards: [card, second, third], reviews, days: 30, now });
    expect(insights.summary).toMatchObject({
      reviewCount: 7,
      rememberedCount: 4,
      unsureCount: 3,
      recallRate: 57.1,
      repeatUnsureCardCount: 1,
      consistentRememberedCardCount: 1,
    });
    expect(insights.cards[0]).toMatchObject({
      repeatUnsure: true,
      rememberedStreak: 1,
      unsureStreak: 0,
    });
    expect(insights.cards[1]).toMatchObject({ consistentRemembered: true, rememberedStreak: 3 });
    expect(insights.cards[2]).toMatchObject({ repeatUnsure: false, unsureStreak: 1 });
  });

  it('orders equal-time history by device then sequence and preserves deterministic results', () => {
    const reviews = [event(3, 'easy'), event(1, 'again'), event(2, 'hard')];
    const insights = buildRecallInsights({ cards: [card], reviews, days: null, now });
    expect(insights.cards[0]!.history.map((entry) => entry.rating)).toEqual([
      'again',
      'hard',
      'easy',
    ]);
    expect(insights.cards[0]!.history.map((entry) => entry.remembered)).toEqual([
      false,
      false,
      true,
    ]);
    expect(insights.summary.lastReviewedAt).toBe(now);
  });

  it('does not label a trend until both equal-length periods have at least three recorded reviews', () => {
    const previous = '2026-10-10T12:00:00.000Z';
    const reviews = [event(1, 'again', previous), event(2, 'again', previous), event(3, 'good')];
    const lowEvidence = buildRecallInsights({ cards: [card], reviews, days: 7, now });
    expect(lowEvidence.summary.trend).toMatchObject({
      direction: 'insufficient',
      changePoints: null,
      recentReviewCount: 1,
      previousReviewCount: 2,
    });
    const improving = buildRecallInsights({
      cards: [card],
      reviews: [...reviews, event(4, 'hard', previous), event(5, 'easy'), event(6, 'good')],
      days: 7,
      now,
    });
    expect(improving.summary.trend).toMatchObject({
      direction: 'improving',
      changePoints: 100,
      recentRate: 100,
      previousRate: 0,
      comparisonDays: 7,
      recentReviewCount: 3,
      previousReviewCount: 3,
    });
    expect(improving.cards[0]!.trend).toEqual(improving.summary.trend);
    expect(improving.summary.reviewCount).toBe(3);
  });

  it('compares the latest 30 calendar days with the preceding 30 for all-time insights', () => {
    const reviews = [
      event(1, 'good', '2026-09-01T12:00:00.000Z'),
      event(2, 'easy', '2026-09-02T12:00:00.000Z'),
      event(3, 'good', '2026-09-03T12:00:00.000Z'),
      event(4, 'hard'),
      event(5, 'again'),
      event(6, 'hard'),
    ];
    const insights = buildRecallInsights({ cards: [card], reviews, days: null, now });
    expect(insights.window.since).toBeNull();
    expect(insights.summary.reviewCount).toBe(6);
    expect(insights.summary.trend).toMatchObject({
      comparisonDays: 30,
      direction: 'declining',
      changePoints: -100,
    });
  });

  it('bounds card drilldowns while retaining complete counts and marking omitted events', () => {
    const reviews = Array.from({ length: 105 }, (_, index) =>
      event(index + 1, index % 2 ? 'good' : 'again'),
    );
    const insights = buildRecallInsights({ cards: [card], reviews, days: null, now });
    expect(insights.cards[0]!.history).toHaveLength(100);
    expect(insights.cards[0]!.history[0]!.id).toBe(reviews[5]!.id);
    expect(insights.cards[0]).toMatchObject({
      historyTotal: 105,
      historyTruncated: true,
      reviewCount: 105,
    });
    expect(insights.summary.reviewCount).toBe(105);
    expect(recallInsightsSchema.safeParse(insights).success).toBe(true);
  });

  it('rejects invalid timezones and dates instead of silently changing the reporting window', () => {
    expect(() =>
      buildRecallInsights({ cards: [], reviews: [], days: 7, now, timezone: 'Mars/Olympus' }),
    ).toThrow(RangeError);
    expect(() =>
      buildRecallInsights({ cards: [], reviews: [], days: 7, now: 'not a date' }),
    ).toThrow(RangeError);
    expect(() => buildRecallInsights({ cards: [], reviews: [], days: 14, now })).toThrow();
  });
});
