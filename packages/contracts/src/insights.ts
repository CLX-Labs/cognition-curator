import { z } from 'zod';
import type { ReviewEvent } from './index.js';

const uuid = z.uuid().toLowerCase();
const dateTime = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();
const rate = z.number().min(0).max(100).nullable();
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const insightDaysSchema = z.union([z.literal(7), z.literal(30), z.literal(90), z.null()]);
export type InsightDays = z.infer<typeof insightDaysSchema>;
export const insightCardSchema = z.strictObject({
  id: uuid,
  deckId: uuid,
  deckName: z.string().max(200),
  front: z.string().max(20_000),
  back: z.string().max(30_000),
  deletedAt: dateTime.nullable().optional(),
});
export type InsightCard = z.infer<typeof insightCardSchema>;
export const recallTrendSchema = z.strictObject({
  direction: z.enum(['improving', 'declining', 'steady', 'insufficient']),
  changePoints: z.number().min(-100).max(100).nullable(),
  comparisonDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  recentRate: rate,
  previousRate: rate,
  recentReviewCount: count,
  previousReviewCount: count,
});
export type RecallTrend = z.infer<typeof recallTrendSchema>;
const countFields = {
  reviewCount: count,
  rememberedCount: count,
  unsureCount: count,
  recallRate: rate,
};
export const recallHistoryEventSchema = z.strictObject({
  id: uuid,
  rating: z.enum(['again', 'hard', 'good', 'easy']),
  remembered: z.boolean(),
  reviewedAt: dateTime,
  elapsedMs: z.number().int().min(0).max(86_400_000),
});
export type RecallHistoryEvent = z.infer<typeof recallHistoryEventSchema>;
export const recallCardInsightsSchema = z.strictObject({
  id: uuid,
  deckId: uuid,
  deckName: z.string().max(200),
  front: z.string().max(20_000),
  back: z.string().max(30_000),
  ...countFields,
  lastReviewedAt: dateTime.nullable(),
  rememberedStreak: count,
  unsureStreak: count,
  consistentRemembered: z.boolean(),
  repeatUnsure: z.boolean(),
  trend: recallTrendSchema,
  history: z.array(recallHistoryEventSchema).max(100),
  historyTotal: count,
  historyTruncated: z.boolean(),
});
export type RecallCardInsights = z.infer<typeof recallCardInsightsSchema>;
export const recallInsightsSchema = z.strictObject({
  generatedAt: dateTime,
  excludedEditedCardCount: count,
  window: z.strictObject({
    days: insightDaysSchema,
    since: dateTime.nullable(),
    until: dateTime,
    timezone: z.string().min(1).max(100),
  }),
  summary: z.strictObject({
    cardCount: count,
    reviewedCardCount: count,
    unreviewedCardCount: count,
    ...countFields,
    activeDays: count,
    lastReviewedAt: dateTime.nullable(),
    consistentRememberedCardCount: count,
    repeatUnsureCardCount: count,
    trend: recallTrendSchema,
  }),
  cards: z.array(recallCardInsightsSchema),
  daily: z.array(z.strictObject({ date: localDate, ...countFields })),
  weekly: z.array(z.strictObject({ weekStart: localDate, ...countFields })),
});
export type RecallInsights = z.infer<typeof recallInsightsSchema>;

export interface RecallInsightsInput {
  cards: readonly InsightCard[];
  reviews: readonly ReviewEvent[];
  days: number | null;
  now?: string;
  timezone?: string;
}

const DAY_MS = 86_400_000;
const HISTORY_LIMIT = 100;
const MIN_TREND_REVIEWS = 3;

interface TimedReview {
  review: ReviewEvent;
  time: number;
  date: string;
}

function remembered(review: ReviewEvent): boolean {
  return review.rating === 'good' || review.rating === 'easy';
}

function roundedRate(successes: number, total: number): number | null {
  return total === 0 ? null : Math.round((successes / total) * 1_000) / 10;
}

function counts(events: readonly TimedReview[]) {
  const rememberedCount = events.filter(({ review }) => remembered(review)).length;
  return {
    reviewCount: events.length,
    rememberedCount,
    unsureCount: events.length - rememberedCount,
    recallRate: roundedRate(rememberedCount, events.length),
  };
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function monday(date: string): string {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return shiftDate(date, -(day === 0 ? 6 : day - 1));
}

function dateFormatter(timezone: string) {
  // Intl throws RangeError for an invalid timezone. The caller can surface a
  // validation error instead of quietly reporting another timezone's days.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return (time: number): string => {
    const parts = formatter.formatToParts(new Date(time));
    const part = (type: string) => parts.find((item) => item.type === type)!.value;
    return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
  };
}

function startOfLocalDate(date: string, format: (time: number) => string): string {
  // Search for the first instant in this local day. Using calendar dates avoids
  // treating a DST day as exactly 24 hours, including midnight offset changes.
  const utcMidnight = Date.parse(`${date}T00:00:00.000Z`);
  let low = utcMidnight - DAY_MS * 2;
  let high = utcMidnight + DAY_MS * 2;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (format(middle) < date) low = middle + 1;
    else high = middle;
  }
  return new Date(low).toISOString();
}

function trend(
  events: readonly TimedReview[],
  comparisonDays: 7 | 30 | 90,
  recentStart: string,
  previousStart: string,
): RecallTrend {
  const recent = counts(events.filter((event) => event.date >= recentStart));
  const previous = counts(
    events.filter((event) => event.date >= previousStart && event.date < recentStart),
  );
  const enough =
    recent.reviewCount >= MIN_TREND_REVIEWS && previous.reviewCount >= MIN_TREND_REVIEWS;
  const changePoints =
    enough && recent.recallRate !== null && previous.recallRate !== null
      ? Math.round((recent.recallRate - previous.recallRate) * 10) / 10
      : null;
  return {
    direction:
      changePoints === null
        ? 'insufficient'
        : changePoints >= 10
          ? 'improving'
          : changePoints <= -10
            ? 'declining'
            : 'steady',
    changePoints,
    comparisonDays,
    recentRate: recent.recallRate,
    previousRate: previous.recallRate,
    recentReviewCount: recent.reviewCount,
    previousReviewCount: previous.reviewCount,
  };
}

/**
 * Reports recorded, self-rated review events only. Schedule/import checkpoint
 * counters cannot reconstruct when or how a person answered a card.
 * good/easy mean remembered; again/hard mean unsure throughout this report.
 */
export function buildRecallInsights(input: RecallInsightsInput): RecallInsights {
  const days = insightDaysSchema.parse(input.days);
  const timezone = input.timezone ?? 'UTC';
  const formatDate = dateFormatter(timezone);
  const now = input.now === undefined ? Date.now() : Date.parse(input.now);
  if (!Number.isFinite(now)) throw new RangeError('Choose a valid insights date.');
  const generatedAt = new Date(now).toISOString();
  const today = formatDate(now);
  const since = days === null ? null : shiftDate(today, -(days - 1));
  const comparisonDays = days ?? 30;
  const recentStart = shiftDate(today, -(comparisonDays - 1));
  const previousStart = shiftDate(recentStart, -comparisonDays);
  const cardMap = new Map<string, InsightCard>();
  for (const card of input.cards) {
    if (card.deletedAt == null && !cardMap.has(card.id)) cardMap.set(card.id, card);
  }

  const candidates = input.reviews
    .filter((review) => {
      const card = cardMap.get(review.cardId);
      const time = Date.parse(review.reviewedAt);
      return card?.deckId === review.deckId && Number.isFinite(time) && time <= now;
    })
    .map((review) => ({
      review,
      time: Date.parse(review.reviewedAt),
      date: formatDate(Date.parse(review.reviewedAt)),
    }))
    .sort(
      (a, b) =>
        a.time - b.time ||
        a.review.deviceId.localeCompare(b.review.deviceId) ||
        a.review.deviceSequence - b.review.deviceSequence ||
        a.review.id.localeCompare(b.review.id),
    );
  const seenIds = new Set<string>();
  const seenSequences = new Set<string>();
  const events: TimedReview[] = [];
  for (const event of candidates) {
    const sequence = `${event.review.deviceId}:${event.review.deviceSequence}`;
    if (seenIds.has(event.review.id) || seenSequences.has(sequence)) continue;
    seenIds.add(event.review.id);
    seenSequences.add(sequence);
    events.push(event);
  }

  const allByCard = new Map<string, TimedReview[]>();
  for (const event of events) {
    const list = allByCard.get(event.review.cardId) ?? [];
    list.push(event);
    allByCard.set(event.review.cardId, list);
  }
  const inWindow = (event: TimedReview) => since === null || event.date >= since;
  const selected = events.filter(inWindow);
  const cards = [...cardMap.values()].map((card): RecallCardInsights => {
    const all = allByCard.get(card.id) ?? [];
    const scoped = all.filter(inWindow);
    let rememberedStreak = 0;
    let unsureStreak = 0;
    const last = scoped.at(-1);
    if (last) {
      const outcome = remembered(last.review);
      for (let index = scoped.length - 1; index >= 0; index--) {
        if (remembered(scoped[index]!.review) !== outcome) break;
        if (outcome) rememberedStreak++;
        else unsureStreak++;
      }
    }
    const lastThree = scoped.slice(-3);
    return {
      id: card.id,
      deckId: card.deckId,
      deckName: card.deckName,
      front: card.front,
      back: card.back,
      ...counts(scoped),
      lastReviewedAt: last?.review.reviewedAt ?? null,
      rememberedStreak,
      unsureStreak,
      consistentRemembered: rememberedStreak >= 3,
      repeatUnsure:
        lastThree.length >= 2 && lastThree.filter((event) => !remembered(event.review)).length >= 2,
      trend: trend(all, comparisonDays, recentStart, previousStart),
      history: scoped.slice(-HISTORY_LIMIT).map(({ review }) => ({
        id: review.id,
        rating: review.rating,
        remembered: remembered(review),
        reviewedAt: review.reviewedAt,
        elapsedMs: review.elapsedMs,
      })),
      historyTotal: scoped.length,
      historyTruncated: scoped.length > HISTORY_LIMIT,
    };
  });
  const byDate = new Map<string, TimedReview[]>();
  for (const event of selected) {
    const list = byDate.get(event.date) ?? [];
    list.push(event);
    byDate.set(event.date, list);
  }
  const daily: RecallInsights['daily'] = [];
  const firstDate = since ?? selected.at(0)?.date;
  if (firstDate) {
    for (let date = firstDate; date <= today; date = shiftDate(date, 1)) {
      daily.push({ date, ...counts(byDate.get(date) ?? []) });
    }
  }
  const byWeek = new Map<string, TimedReview[]>();
  for (const day of daily) {
    const week = monday(day.date);
    const list = byWeek.get(week) ?? [];
    list.push(...(byDate.get(day.date) ?? []));
    byWeek.set(week, list);
  }
  const reviewedCardCount = cards.filter((card) => card.reviewCount > 0).length;
  return {
    generatedAt,
    excludedEditedCardCount: 0,
    window: {
      days,
      since: since === null ? null : startOfLocalDate(since, formatDate),
      until: generatedAt,
      timezone,
    },
    summary: {
      cardCount: cards.length,
      reviewedCardCount,
      unreviewedCardCount: cards.length - reviewedCardCount,
      ...counts(selected),
      activeDays: byDate.size,
      lastReviewedAt: selected.at(-1)?.review.reviewedAt ?? null,
      consistentRememberedCardCount: cards.filter((card) => card.consistentRemembered).length,
      repeatUnsureCardCount: cards.filter((card) => card.repeatUnsure).length,
      trend: trend(events, comparisonDays, recentStart, previousStart),
    },
    cards,
    daily,
    weekly: [...byWeek].map(([weekStart, weekEvents]) => ({ weekStart, ...counts(weekEvents) })),
  };
}
