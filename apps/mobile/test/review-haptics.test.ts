import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const rig = vi.hoisted(() => ({
  impact: vi.fn<(style: string) => Promise<void>>(),
  selection: vi.fn<() => Promise<void>>(),
}));
vi.mock('expo-haptics', () => ({
  impactAsync: rig.impact,
  selectionAsync: rig.selection,
  ImpactFeedbackStyle: { Heavy: 'heavy', Light: 'light' },
}));

import { createReviewHaptics } from '../src/review-haptics';

beforeEach(() => {
  vi.useFakeTimers();
  rig.impact.mockReset().mockResolvedValue(undefined);
  rig.selection.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it('remembering uses one firm pulse while uncertainty uses two light pulses', () => {
  const haptics = createReviewHaptics();
  expect(haptics.answer(true)).toBeUndefined();
  expect(rig.impact.mock.calls).toEqual([['heavy']]);
  vi.advanceTimersByTime(1000);
  expect(rig.impact.mock.calls).toEqual([['heavy']]);

  haptics.answer(false);
  expect(rig.impact.mock.calls).toEqual([['heavy'], ['light']]);
  vi.advanceTimersByTime(139);
  expect(rig.impact).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(1);
  expect(rig.impact.mock.calls).toEqual([['heavy'], ['light'], ['light']]);
  vi.advanceTimersByTime(1000);
  expect(rig.impact).toHaveBeenCalledTimes(3);
  expect(rig.selection).not.toHaveBeenCalled();
});

it('revealing uses a separate selection tick without an answer pulse', () => {
  const haptics = createReviewHaptics();
  expect(haptics.reveal()).toBeUndefined();
  expect(rig.selection).toHaveBeenCalledExactlyOnceWith();
  vi.advanceTimersByTime(1000);
  expect(rig.impact).not.toHaveBeenCalled();
});

it.each(['remembered', 'reveal', 'cancel'] as const)(
  'a newer %s action cancels an unfinished uncertainty pattern',
  (action) => {
    const haptics = createReviewHaptics();
    haptics.answer(false);
    vi.advanceTimersByTime(70);
    if (action === 'remembered') haptics.answer(true);
    else if (action === 'reveal') haptics.reveal();
    else haptics.cancel();
    vi.advanceTimersByTime(1000);
    expect(rig.impact.mock.calls).toEqual(
      action === 'remembered' ? [['light'], ['heavy']] : [['light']],
    );
    expect(rig.selection).toHaveBeenCalledTimes(action === 'reveal' ? 1 : 0);
  },
);

it('a newer uncertainty pattern gets its own second pulse without the old timer', () => {
  const haptics = createReviewHaptics();
  haptics.answer(false);
  vi.advanceTimersByTime(100);
  haptics.answer(false);
  vi.advanceTimersByTime(40);
  expect(rig.impact.mock.calls).toEqual([['light'], ['light']]);
  vi.advanceTimersByTime(100);
  expect(rig.impact.mock.calls).toEqual([['light'], ['light'], ['light']]);
});

it('pausing cancels pending pulses and silences actions without replaying them on resume', () => {
  const haptics = createReviewHaptics();
  haptics.answer(false);
  haptics.setActive(false);
  haptics.answer(true);
  haptics.answer(false);
  haptics.reveal();
  vi.advanceTimersByTime(1000);
  expect(rig.impact.mock.calls).toEqual([['light']]);
  expect(rig.selection).not.toHaveBeenCalled();
  haptics.setActive(true);
  vi.advanceTimersByTime(1000);
  expect(rig.impact.mock.calls).toEqual([['light']]);
  haptics.reveal();
  haptics.answer(true);
  expect(rig.selection).toHaveBeenCalledExactlyOnceWith();
  expect(rig.impact.mock.calls).toEqual([['light'], ['heavy']]);
});

it('schedules the second pulse even when the first native request never resolves', () => {
  rig.impact.mockImplementationOnce(() => new Promise<void>(() => undefined));
  const haptics = createReviewHaptics();
  haptics.answer(false);
  vi.advanceTimersByTime(140);
  expect(rig.impact.mock.calls).toEqual([['light'], ['light']]);
});

it.each(['sync', 'async'] as const)(
  'contains %s native failures for both pulse types and permits later feedback',
  async (failure) => {
    const fail = () => {
      if (failure === 'sync') throw new Error('Haptics unavailable');
      return Promise.reject(new Error('Haptics unavailable'));
    };
    rig.impact.mockImplementationOnce(fail).mockImplementationOnce(fail);
    rig.selection.mockImplementationOnce(fail);
    const haptics = createReviewHaptics();
    expect(() => haptics.answer(false)).not.toThrow();
    expect(() => vi.advanceTimersByTime(140)).not.toThrow();
    expect(() => haptics.reveal()).not.toThrow();
    await Promise.resolve();
    expect(() => haptics.answer(true)).not.toThrow();
    expect(rig.impact.mock.calls).toEqual([['light'], ['light'], ['heavy']]);
    expect(rig.selection).toHaveBeenCalledExactlyOnceWith();
  },
);
