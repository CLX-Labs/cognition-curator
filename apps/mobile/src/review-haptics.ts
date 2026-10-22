import * as Haptics from 'expo-haptics';

function safely(trigger: () => Promise<void>): void {
  try {
    void trigger().catch(() => undefined);
  } catch {
    // Device feedback must never interrupt a review or reveal.
  }
}

export function createReviewHaptics() {
  let pending: ReturnType<typeof setTimeout> | undefined;
  let active = true;

  function cancel() {
    if (pending !== undefined) clearTimeout(pending);
    pending = undefined;
  }

  return {
    answer(remembered: boolean): void {
      cancel();
      if (!active) return;
      safely(() =>
        Haptics.impactAsync(
          remembered ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light,
        ),
      );
      if (!remembered) {
        pending = setTimeout(() => {
          pending = undefined;
          if (active) safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
        }, 140);
      }
    },
    reveal(): void {
      cancel();
      if (active) safely(() => Haptics.selectionAsync());
    },
    cancel,
    setActive(value: boolean): void {
      cancel();
      active = value;
    },
  };
}
