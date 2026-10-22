import { beforeEach, expect, it, vi } from 'vitest';

const rig = vi.hoisted(() => ({
  notification: vi.fn<(type: string) => Promise<void>>(),
}));
vi.mock('expo-haptics', () => ({
  notificationAsync: rig.notification,
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { playReviewHaptic } from '../src/review-haptics';

beforeEach(() => {
  rig.notification.mockReset().mockResolvedValue(undefined);
});

it.each([
  { remembered: true, type: 'success' },
  { remembered: false, type: 'warning' },
])('uses the native $type pattern for remembered=$remembered', ({ remembered, type }) => {
  expect(playReviewHaptic(remembered)).toBeUndefined();
  expect(rig.notification).toHaveBeenCalledExactlyOnceWith(type);
});

it('a rejected haptic request does not reject the review or prevent later feedback', async () => {
  rig.notification.mockRejectedValueOnce(new Error('Haptics unavailable'));
  expect(() => playReviewHaptic(true)).not.toThrow();
  await Promise.resolve();
  playReviewHaptic(false);
  expect(rig.notification.mock.calls).toEqual([['success'], ['warning']]);
});

it('a synchronous native module failure is contained', () => {
  rig.notification.mockImplementationOnce(() => {
    throw new Error('Native feedback failed');
  });
  expect(() => playReviewHaptic(false)).not.toThrow();
  expect(rig.notification).toHaveBeenCalledExactlyOnceWith('warning');
});
