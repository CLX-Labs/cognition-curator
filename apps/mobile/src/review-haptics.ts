import * as Haptics from 'expo-haptics';

export function playReviewHaptic(remembered: boolean): void {
  try {
    void Haptics.notificationAsync(
      remembered
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Warning,
    ).catch(() => undefined);
  } catch {
    // Optional device feedback must never interrupt a saved review.
  }
}
