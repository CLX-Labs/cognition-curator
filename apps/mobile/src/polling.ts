import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

export function useAppActive() {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setActive(state === 'active'),
    );
    // Activation can arrive after render but before the listener is installed.
    setActive(AppState.currentState === 'active');
    return () => subscription.remove();
  }, []);
  return active;
}

/** Poll after completion, even when the response/state is unchanged. Never overlap requests. */
export function usePolling(enabled: boolean, work: () => Promise<void>, delay = 2500) {
  const latest = useRef(work);
  const running = useRef(false);
  latest.current = work;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (cancelled) return;
      if (!running.current) {
        running.current = true;
        try {
          await latest.current();
        } catch {
          /* The caller reports request errors and disables polling. */
        } finally {
          running.current = false;
        }
      }
      if (!cancelled) timer = setTimeout(() => void tick(), delay);
    };
    timer = setTimeout(() => void tick(), delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, delay]);
}
