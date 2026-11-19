import { useLayoutEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useSegments } from 'expo-router';
import PostHog from 'posthog-react-native';
import { useStore } from './store';
import { useAnalyticsConsent } from './analytics-consent';
import { analyticsConfig, analyticsOptions, analyticsScreen } from './analytics-config';
import { createAnalyticsSession } from './analytics-session';
import { release } from './release';

const config = analyticsConfig(
  process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN,
  process.env.EXPO_PUBLIC_POSTHOG_HOST,
);
// Replay stop-status failures must stay observable before reusing an identity.
// The current Android bridge hides native status errors; keep this rollout iOS-only.
const supported = Platform.OS === 'ios' &&
  (!__DEV__ || process.env.EXPO_PUBLIC_POSTHOG_ENABLE_DEV === 'true');

// One lazily initialized SDK for the process. No provider autocapture: native replay
// records the UI while screen events are explicitly reduced to known route templates.
const analytics = createAnalyticsSession((canCapture) => {
  if (!config || !supported) throw new Error('App analytics is not configured for this build.');
  const client = new PostHog(config.projectToken, analyticsOptions(config, canCapture));
  return {
    identify: (id) => client.identify(id),
    register: (properties) => client.register(properties),
    screen: (name) => client.screen(name, {
      recollect_release: release.id,
      ...(release.version ? { recollect_version: release.version } : {}),
      ...(release.commit ? { recollect_commit: release.commit } : {}),
    }),
    reset: () => client.reset(),
    optIn: () => client.optIn(),
    optOut: () => client.optOut(),
    startSessionRecording: (resume) => client.startSessionRecording(resume),
    stopSessionRecording: () => client.stopSessionRecording(),
    isSessionRecordingActive: async () => (await import('@posthog/react-native-plugin')).isEnabled(),
  };
});

export function AnalyticsObserver() {
  const { ready, session, repository, deletionBusy, deletionRecovery, initializationError } = useStore();
  const consent = useAnalyticsConsent();
  const segments = useSegments();
  const screen = analyticsScreen(segments);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const userId = session?.user.id;
  const blockedByDeletion = deletionRecovery &&
    (!deletionRecovery.localCleared || deletionRecovery.ownerId === userId);
  const eligible = !!config && supported && foreground && ready && consent.loaded && consent.allowed &&
    !!userId && repository?.ownerId === userId && !deletionBusy &&
    !blockedByDeletion && !initializationError;

  useLayoutEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      // Stop before the next render when a native authentication sheet or the
      // app switcher makes the application inactive.
      if (!active) void analytics.update(null);
      setForeground(active);
    });
    return () => subscription.remove();
  }, []);

  useLayoutEffect(() => {
    void analytics.update(eligible && screen && userId ? { ownerId: userId, screen } : null);
  }, [eligible, screen, userId]);

  useLayoutEffect(() => () => { void analytics.update(null); }, []);
  return null;
}
