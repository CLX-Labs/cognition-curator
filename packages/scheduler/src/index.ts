import {
  ALGORITHM_VERSION,
  LEGACY_ALGORITHM_VERSION,
  algorithmVersionSchema,
  dateTimeSchema,
  ratingSchema,
  scheduleStateSchema,
  type Rating,
  type ReviewEvent,
  type ScheduleState,
  type AlgorithmVersion,
} from '@recollect/contracts';

export { ALGORITHM_VERSION };
export const DAY_SECONDS = 86_400;
export const MAX_INTERVAL_SECONDS = 3_650 * DAY_SECONDS;
const LEARNING_STEPS = [60, 600] as const;

function timestamp(value: string): number {
  dateTimeSchema.parse(value);
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error('Invalid review timestamp');
  return time;
}
function clampEase(value: number): number {
  return Math.round(Math.min(3, Math.max(1.3, value)) * 100) / 100;
}
function boundedInterval(value: number): number {
  return Math.min(MAX_INTERVAL_SECONDS, Math.max(1, Math.round(value)));
}

/** No ambient clock or randomness: use exactly the same input on the server and device. */
export function initialSchedule(now: string): ScheduleState {
  return {
    // New cards are due immediately in either version. Retain the legacy wire
    // value until a v2 review so older installed clients can keep syncing.
    algorithmVersion: LEGACY_ALGORITHM_VERSION,
    phase: 'new',
    dueAt: new Date(timestamp(now)).toISOString(),
    intervalSeconds: 0,
    easeFactor: 2.5,
    learningStep: 0,
    repetitions: 0,
    lapses: 0,
    lastReviewedAt: null,
    totalReviews: 0,
  };
}

export function reviewSchedule(
  previous: ScheduleState,
  event: Pick<ReviewEvent, 'rating' | 'reviewedAt'> & { algorithmVersion?: AlgorithmVersion },
): ScheduleState {
  const state = scheduleStateSchema.parse(previous);
  const rating = ratingSchema.parse(event.rating);
  const at = timestamp(event.reviewedAt);
  if (state.lastReviewedAt && at < timestamp(state.lastReviewedAt)) {
    throw new Error('Review precedes schedule checkpoint; replay from an earlier checkpoint');
  }
  const version = algorithmVersionSchema.parse(event.algorithmVersion ?? ALGORITHM_VERSION);
  if (version === ALGORITHM_VERSION) {
    // No minute-scale learning loops. Misses get breathing room; successful
    // recall starts at a week and extends an established review interval.
    const established = state.phase === 'review';
    const ease = clampEase(state.easeFactor);
    const interval = boundedInterval(
      rating === 'again'
        ? 3 * DAY_SECONDS
        : rating === 'hard'
          ? Math.max(3 * DAY_SECONDS, established ? state.intervalSeconds * 1.2 : 0)
          : rating === 'easy'
            ? Math.max(14 * DAY_SECONDS, established ? state.intervalSeconds * ease * 1.3 : 0)
            : Math.max(7 * DAY_SECONDS, established ? state.intervalSeconds * ease : 0),
    );
    return {
      algorithmVersion: version,
      phase: rating === 'again' ? 'relearning' : 'review',
      dueAt: new Date(at + interval * 1_000).toISOString(),
      intervalSeconds: interval,
      easeFactor: clampEase(
        ease +
          (rating === 'again' ? -0.2 : rating === 'hard' ? -0.15 : rating === 'easy' ? 0.15 : 0),
      ),
      learningStep: 0,
      repetitions: rating === 'again' ? 0 : state.repetitions + 1,
      lapses: state.lapses + (rating === 'again' && established ? 1 : 0),
      lastReviewedAt: new Date(at).toISOString(),
      totalReviews: state.totalReviews + 1,
    };
  }
  let interval: number;
  let phase = state.phase;
  let learningStep = state.learningStep;
  // Import keeps the old checkpoint intact. New reviews always use v1 bounds,
  // including Good and learning ratings that do not otherwise adjust ease.
  let ease = clampEase(state.easeFactor);
  let repetitions = state.repetitions;
  let lapses = state.lapses;

  if (rating === 'again') {
    interval = LEARNING_STEPS[0];
    learningStep = 0;
    repetitions = 0;
    const wasReview = state.phase === 'review' || state.phase === 'relearning';
    phase = wasReview ? 'relearning' : 'learning';
    if (state.phase === 'review') {
      ease = clampEase(ease - 0.2);
      lapses += 1;
    }
  } else if (state.phase !== 'review') {
    if (rating === 'easy') {
      interval = 4 * DAY_SECONDS;
      phase = 'review';
      learningStep = 0;
      repetitions = 1;
    } else if (rating === 'hard') {
      interval = learningStep === 0 ? LEARNING_STEPS[0] : LEARNING_STEPS[1];
      phase = state.phase === 'relearning' ? 'relearning' : 'learning';
    } else if (learningStep === 0) {
      interval = LEARNING_STEPS[1];
      learningStep = 1;
      phase = state.phase === 'relearning' ? 'relearning' : 'learning';
    } else {
      interval = DAY_SECONDS;
      learningStep = 0;
      phase = 'review';
      repetitions = 1;
    }
  } else {
    const current = Math.max(DAY_SECONDS, state.intervalSeconds);
    repetitions += 1;
    if (rating === 'hard') {
      interval = current * 1.2;
      ease = clampEase(ease - 0.15);
    } else if (rating === 'easy') {
      interval = Math.max(4 * DAY_SECONDS, current * ease * 1.3);
      ease = clampEase(ease + 0.15);
    } else {
      interval = current * ease;
    }
  }
  interval = boundedInterval(interval);
  return {
    algorithmVersion: LEGACY_ALGORITHM_VERSION,
    phase,
    dueAt: new Date(at + interval * 1_000).toISOString(),
    intervalSeconds: interval,
    easeFactor: ease,
    learningStep,
    repetitions,
    lapses,
    lastReviewedAt: new Date(at).toISOString(),
    totalReviews: state.totalReviews + 1,
  };
}

function lexical(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
/** Tie-breaking is byte-stable and independent of server arrival order and device locale. */
export function compareReviews(a: ReviewEvent, b: ReviewEvent): number {
  return (
    timestamp(a.reviewedAt) - timestamp(b.reviewedAt) ||
    lexical(a.deviceId, b.deviceId) ||
    a.deviceSequence - b.deviceSequence ||
    lexical(a.id, b.id)
  );
}
function eventIdentity(e: ReviewEvent): string {
  return JSON.stringify([
    e.id,
    e.cardId,
    e.deckId,
    e.deviceId,
    e.deviceSequence,
    e.rating,
    e.reviewedAt,
    e.elapsedMs,
    e.algorithmVersion,
  ]);
}

/** Pass only post-checkpoint events. Imported historical reviews are archival, never replayed. */
export function replayReviews(
  checkpoint: ScheduleState,
  events: readonly ReviewEvent[],
): ScheduleState {
  const unique = new Map<string, ReviewEvent>();
  for (const event of events) {
    const previous = unique.get(event.id);
    if (previous && eventIdentity(previous) !== eventIdentity(event)) {
      throw new Error('Review event ID reused with different content');
    }
    unique.set(event.id, event);
  }
  return [...unique.values()]
    .sort(compareReviews)
    .reduce<ScheduleState>(reviewSchedule, { ...checkpoint });
}

export function isDue(schedule: ScheduleState, now: string): boolean {
  return timestamp(schedule.dueAt) <= timestamp(now);
}
export function previewIntervals(
  schedule: ScheduleState,
  now: string,
  algorithmVersion: AlgorithmVersion = ALGORITHM_VERSION,
): Record<Rating, number> {
  return Object.fromEntries(
    ratingSchema.options.map((rating) => [
      rating,
      reviewSchedule(schedule, { rating, reviewedAt: now, algorithmVersion }).intervalSeconds,
    ]),
  ) as Record<Rating, number>;
}
