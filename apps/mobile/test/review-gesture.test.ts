import { expect, it } from 'vitest';
import { isHorizontalReviewDrag, reviewSwipe } from '../src/review-gesture';

it('captures a deliberate single finger horizontal drag without taking over scrolling', () => {
  expect(isHorizontalReviewDrag({ dx: 30, dy: 5, numberActiveTouches: 1 })).toBe(true);
  expect(isHorizontalReviewDrag({ dx: -30, dy: 5, numberActiveTouches: 1 })).toBe(true);
  expect(isHorizontalReviewDrag({ dx: 5, dy: 40, numberActiveTouches: 1 })).toBe(false);
  expect(isHorizontalReviewDrag({ dx: 10, dy: 0, numberActiveTouches: 1 })).toBe(false);
  expect(isHorizontalReviewDrag({ dx: 30, dy: 5, numberActiveTouches: 2 })).toBe(false);
});

it.each([300, 390, 760])('right remembers and left misses at card width %s', (width) => {
  expect(reviewSwipe({ dx: 150, dy: 5, vx: 0 }, width)).toBe('remembered');
  expect(reviewSwipe({ dx: -150, dy: -5, vx: 0 }, width)).toBe('missed');
});

it('ignores short, vertical, and diagonal movement, and a flick in the opposite direction', () => {
  expect(reviewSwipe({ dx: 20, dy: 0, vx: 1 }, 320)).toBeNull();
  expect(reviewSwipe({ dx: 75, dy: 1, vx: 0 }, 320)).toBeNull();
  expect(reviewSwipe({ dx: 120, dy: 200, vx: 2 }, 320)).toBeNull();
  expect(reviewSwipe({ dx: 120, dy: 90, vx: 2 }, 320)).toBeNull();
  expect(reviewSwipe({ dx: 40, dy: 1, vx: -1 }, 320)).toBeNull();
});

it('accepts a deliberate short flick in either direction', () => {
  expect(reviewSwipe({ dx: 40, dy: 1, vx: 0.8 }, 320)).toBe('remembered');
  expect(reviewSwipe({ dx: -40, dy: -1, vx: -0.8 }, 320)).toBe('missed');
});
