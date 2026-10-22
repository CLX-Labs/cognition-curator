import { describe, expect, it } from 'vitest';
import { type ReviewEvent } from '@recollect/contracts';
import {
  compareReviews,
  DAY_SECONDS,
  initialSchedule,
  isDue,
  MAX_INTERVAL_SECONDS,
  previewIntervals,
  replayReviews,
  reviewSchedule as currentReviewSchedule,
} from '../src/index.ts';

const at = '2026-10-11T12:00:00.000Z';
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
function event(n: number, patch: Partial<ReviewEvent> = {}): ReviewEvent {
  return {
    id: uuid(n),
    cardId: uuid(100),
    deckId: uuid(200),
    deviceId: uuid(300),
    deviceSequence: n,
    rating: 'good',
    reviewedAt: at,
    elapsedMs: 4_000,
    algorithmVersion: 'sm2-v1',
    ...patch,
  };
}

// Recorded v1 events must continue producing exactly their historical result.
const reviewSchedule = (
  state: Parameters<typeof currentReviewSchedule>[0],
  event: Parameters<typeof currentReviewSchedule>[1],
) => currentReviewSchedule(state, { ...event, algorithmVersion: 'sm2-v1' });

describe('legacy v1 scheduler replay', () => {
  it('uses explicit minute learning steps and graduates after the second good answer', () => {
    const first = reviewSchedule(initialSchedule(at), { rating: 'good', reviewedAt: at });
    expect(first.intervalSeconds).toBe(600);
    expect(first.phase).toBe('learning');
    expect(first.learningStep).toBe(1);
    const second = reviewSchedule(first, { rating: 'good', reviewedAt: first.dueAt });
    expect(second.intervalSeconds).toBe(DAY_SECONDS);
    expect(second.phase).toBe('review');
    expect(second.repetitions).toBe(1);
    expect(second.totalReviews).toBe(2);
  });

  it('regression: a one-day card rated hard gets 1.2 days, not 1,728 days', () => {
    const state = {
      ...initialSchedule(at),
      phase: 'review' as const,
      intervalSeconds: DAY_SECONDS,
    };
    const next = reviewSchedule(state, { rating: 'hard', reviewedAt: at });
    expect(next.intervalSeconds).toBe(103_680);
    expect(next.dueAt).toBe('2026-10-12T16:48:00.000Z');
    expect(next.easeFactor).toBe(2.35);
  });

  it('again resets learning progression, without counting every historical learning step', () => {
    const first = reviewSchedule(initialSchedule(at), { rating: 'good', reviewedAt: at });
    const again = reviewSchedule(first, { rating: 'again', reviewedAt: first.dueAt });
    expect(again.learningStep).toBe(0);
    expect(again.intervalSeconds).toBe(60);
    expect(reviewSchedule(again, { rating: 'good', reviewedAt: again.dueAt }).intervalSeconds).toBe(
      600,
    );
  });

  it('hard repeats the current learning step; easy graduates directly', () => {
    const state = reviewSchedule(initialSchedule(at), { rating: 'good', reviewedAt: at });
    expect(reviewSchedule(state, { rating: 'hard', reviewedAt: state.dueAt }).intervalSeconds).toBe(
      600,
    );
    expect(
      reviewSchedule(initialSchedule(at), { rating: 'easy', reviewedAt: at }).intervalSeconds,
    ).toBe(4 * DAY_SECONDS);
  });

  it('records a lapse once when entering relearning and bounds ease and long intervals', () => {
    const state = {
      ...initialSchedule(at),
      phase: 'review' as const,
      easeFactor: 1.3,
      intervalSeconds: DAY_SECONDS,
    };
    const miss = reviewSchedule(state, { rating: 'again', reviewedAt: at });
    expect(miss.phase).toBe('relearning');
    expect(miss.lapses).toBe(1);
    expect(miss.easeFactor).toBe(1.3);
    expect(reviewSchedule(miss, { rating: 'again', reviewedAt: miss.dueAt }).lapses).toBe(1);
    const long = { ...state, intervalSeconds: MAX_INTERVAL_SECONDS, easeFactor: 3 };
    expect(reviewSchedule(long, { rating: 'easy', reviewedAt: at }).intervalSeconds).toBe(
      MAX_INTERVAL_SECONDS,
    );
  });

  it('derives due status only from the current schedule', () => {
    const reviewed = reviewSchedule(initialSchedule(at), { rating: 'easy', reviewedAt: at });
    expect(isDue(reviewed, at)).toBe(false);
    expect(isDue(reviewed, reviewed.dueAt)).toBe(true);
  });

  it('preserves a fractional legacy checkpoint until its next bounded review', () => {
    const checkpoint = {
      ...initialSchedule(at),
      phase: 'review' as const,
      intervalSeconds: 16_122.599999999999 * 60,
      easeFactor: 3.1,
      dueAt: '2026-10-22T16:42:36.000Z',
    };
    const original = structuredClone(checkpoint);
    expect(replayReviews(checkpoint, [])).toEqual(original);
    const next = reviewSchedule(checkpoint, { rating: 'good', reviewedAt: at });
    expect(next.intervalSeconds).toBe(Math.round(checkpoint.intervalSeconds * 3));
    expect(next.easeFactor).toBe(3);
    expect(checkpoint).toEqual(original);
  });

  it('applies the new bounds to long legacy intervals and every learning rating', () => {
    const checkpoint = {
      ...initialSchedule(at),
      phase: 'review' as const,
      intervalSeconds: MAX_INTERVAL_SECONDS * 2,
      easeFactor: 12,
    };
    expect(reviewSchedule(checkpoint, { rating: 'good', reviewedAt: at }).intervalSeconds).toBe(
      MAX_INTERVAL_SECONDS,
    );
    for (const rating of ['again', 'hard', 'good', 'easy'] as const) {
      const next = reviewSchedule({ ...checkpoint, phase: 'learning' }, { rating, reviewedAt: at });
      expect(next.easeFactor).toBe(3);
      expect(Number.isInteger(next.intervalSeconds)).toBe(true);
    }
  });

  it('is deterministic across arrival order and duplicate transport', () => {
    const events = [
      event(1),
      event(2, { reviewedAt: '2026-10-11T12:10:00.000Z' }),
      event(3, { deviceId: uuid(301), reviewedAt: '2026-10-12T12:10:00.000Z', rating: 'hard' }),
    ];
    const checkpoint = initialSchedule(at);
    expect(replayReviews(checkpoint, [events[2]!, events[0]!, events[1]!, events[0]!])).toEqual(
      replayReviews(checkpoint, events),
    );
    expect(checkpoint.totalReviews).toBe(0);
    expect(replayReviews(checkpoint, events).totalReviews).toBe(3);
  });

  it('uses stable device and sequence tie-breaking for simultaneous reviews', () => {
    const left = event(4, { deviceSequence: 2 });
    const right = event(5, { deviceSequence: 1 });
    expect(compareReviews(left, right)).toBeGreaterThan(0);
    expect(replayReviews(initialSchedule(at), [left, right])).toEqual(
      replayReviews(initialSchedule(at), [right, left]),
    );
  });

  it('rejects event ID payload collisions and histories older than an import checkpoint', () => {
    expect(() =>
      replayReviews(initialSchedule(at), [event(1), event(1, { rating: 'again' })]),
    ).toThrow('different content');
    const checkpoint = reviewSchedule(initialSchedule(at), { rating: 'good', reviewedAt: at });
    expect(() =>
      replayReviews(checkpoint, [event(1, { reviewedAt: '2026-10-10T12:00:00.000Z' })]),
    ).toThrow('precedes schedule checkpoint');
  });

  it('uses elapsed UTC time across timezone and daylight-saving boundaries', () => {
    const spring = initialSchedule('2026-03-08T01:55:00-05:00');
    const next = reviewSchedule(spring, { rating: 'good', reviewedAt: spring.dueAt });
    expect(next.dueAt).toBe('2026-03-08T07:05:00.000Z');
  });

  it('previews every rating without mutating the card or consulting a clock', () => {
    const state = initialSchedule(at);
    const before = structuredClone(state);
    expect(previewIntervals(state, at, 'sm2-v1')).toEqual({
      again: 60,
      hard: 60,
      good: 600,
      easy: 345_600,
    });
    expect(state).toEqual(before);
  });
});

describe('day-based v2 review cadence', () => {
  it('gives an uncertain card three days and a remembered card a week, including old learning cards', () => {
    for (const phase of ['new', 'learning', 'review', 'relearning'] as const) {
      const state = { ...initialSchedule(at), phase, intervalSeconds: 60 };
      expect(previewIntervals(state, at)).toEqual({
        again: 3 * DAY_SECONDS,
        hard: 3 * DAY_SECONDS,
        good: 7 * DAY_SECONDS,
        easy: 14 * DAY_SECONDS,
      });
      const next = currentReviewSchedule(state, { rating: 'again', reviewedAt: at });
      expect(next.algorithmVersion).toBe('sm2-v2');
      expect(next.dueAt).toBe('2026-10-14T12:00:00.000Z');
      expect(isDue(next, '2026-10-12T12:00:00.000Z')).toBe(false);
    }
  });

  it('extends successful recall and resets to days after a miss', () => {
    const first = currentReviewSchedule(initialSchedule(at), { rating: 'good', reviewedAt: at });
    expect(first.intervalSeconds).toBe(7 * DAY_SECONDS);
    const next = currentReviewSchedule(first, { rating: 'good', reviewedAt: first.dueAt });
    expect(next.intervalSeconds).toBe(17.5 * DAY_SECONDS);
    const third = currentReviewSchedule(next, { rating: 'good', reviewedAt: next.dueAt });
    expect(third.intervalSeconds).toBe(43.75 * DAY_SECONDS);
    const missed = currentReviewSchedule(third, { rating: 'again', reviewedAt: third.dueAt });
    expect(missed.intervalSeconds).toBe(3 * DAY_SECONDS);
    expect(missed.lapses).toBe(1);
    expect(
      currentReviewSchedule(missed, { rating: 'good', reviewedAt: missed.dueAt }).intervalSeconds,
    ).toBe(7 * DAY_SECONDS);
    expect(
      currentReviewSchedule(missed, { rating: 'again', reviewedAt: missed.dueAt }).lapses,
    ).toBe(1);
  });

  it('replays mixed versions deterministically without reinterpreting a minute-scale historical event', () => {
    const old = event(1);
    const modern = event(2, { algorithmVersion: 'sm2-v2', reviewedAt: '2026-10-11T12:10:00.000Z' });
    expect(replayReviews(initialSchedule(at), [old]).intervalSeconds).toBe(600);
    const expected = currentReviewSchedule(reviewSchedule(initialSchedule(at), old), modern);
    expect(expected.intervalSeconds).toBe(7 * DAY_SECONDS);
    expect(replayReviews(initialSchedule(at), [modern, old, modern])).toEqual(expected);
    const checkpoint = structuredClone(expected);
    expect(replayReviews(checkpoint, [])).toEqual(expected);
    expect(checkpoint).toEqual(expected);
  });

  it('bounds long intervals and ease, and previews without changing stored schedules', () => {
    const state = {
      ...initialSchedule(at),
      phase: 'review' as const,
      intervalSeconds: MAX_INTERVAL_SECONDS * 2,
      easeFactor: 12,
    };
    const before = structuredClone(state);
    for (const rating of ['hard', 'good', 'easy'] as const) {
      const next = currentReviewSchedule(state, { rating, reviewedAt: at });
      expect(next.intervalSeconds).toBe(MAX_INTERVAL_SECONDS);
      expect(next.easeFactor).toBeLessThanOrEqual(3);
    }
    previewIntervals(state, at);
    expect(state).toEqual(before);
  });
});
