import { expect, it } from 'vitest';
import { isHorizontalReviewDrag, reviewSwipe } from '../src/review-gesture';

it('captures a deliberate single finger horizontal drag without taking over scrolling', () => {
  expect(isHorizontalReviewDrag({ dx: 30, dy: 5, numberActiveTouches: 1 })).toBe(true);
  expect(isHorizontalReviewDrag({ dx: -30, dy: 5, numberActiveTouches: 1 })).toBe(true);
  expect(isHorizontalReviewDrag({ dx: 5, dy: 40, numberActiveTouches: 1 })).toBe(false);
  expect(isHorizontalReviewDrag({ dx: 10, dy: 0, numberActiveTouches: 1 })).toBe(false);
  expect(isHorizontalReviewDrag({ dx: 30, dy: 5, numberActiveTouches: 2 })).toBe(false);
});

it.each(
  [
    { width: 280, threshold: 44 },
    { width: 320, threshold: 45 },
    { width: 390, threshold: 55 },
    { width: 760, threshold: 56 },
  ].flatMap(({ width, threshold }) =>
    (['remembered', 'missed'] as const).map((outcome) => ({
      width,
      threshold,
      outcome,
      direction: outcome === 'remembered' ? 1 : -1,
    })),
  ),
)(
  'accepts a $threshold-point slow swipe for $outcome at card width $width',
  ({ width, threshold, outcome, direction }) => {
    expect(reviewSwipe({ dx: (threshold - 1) * direction, dy: 5, vx: 0 }, width)).toBeNull();
    expect(reviewSwipe({ dx: threshold * direction, dy: 5, vx: 0 }, width)).toBe(outcome);
  },
);

it('ignores short, vertical, and diagonal movement, and a flick in the opposite direction', () => {
  expect(reviewSwipe({ dx: 20, dy: 0, vx: 1 }, 320)).toBeNull();
  expect(reviewSwipe({ dx: 120, dy: 200, vx: 2 }, 320)).toBeNull();
  expect(reviewSwipe({ dx: 120, dy: 90, vx: 2 }, 320)).toBeNull();
  expect(reviewSwipe({ dx: 26, dy: 1, vx: -1 }, 320)).toBeNull();
  expect(reviewSwipe({ dx: -26, dy: 1, vx: 1 }, 320)).toBeNull();
});

it.each([1, -1])(
  'requires both distance and velocity for a short flick in direction %s',
  (direction) => {
    expect(reviewSwipe({ dx: 25 * direction, dy: 1, vx: direction }, 320)).toBeNull();
    expect(reviewSwipe({ dx: 26 * direction, dy: 1, vx: 0.64 * direction }, 320)).toBeNull();
    expect(reviewSwipe({ dx: 26 * direction, dy: 1, vx: 0.65 * direction }, 320)).toBe(
      direction > 0 ? 'remembered' : 'missed',
    );
    expect(reviewSwipe({ dx: 26 * direction, dy: 18, vx: direction }, 320)).toBeNull();
  },
);
