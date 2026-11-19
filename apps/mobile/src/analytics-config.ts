import type { PostHogOptions } from 'posthog-react-native';

export type AnalyticsConfig = { projectToken: string; host: string };

/** Public SDK configuration only; an absent configuration must never break learning. */
export function analyticsConfig(
  projectToken: string | undefined,
  host: string | undefined,
): AnalyticsConfig | null {
  const token = projectToken?.trim() ?? '';
  if (!/^phc_[A-Za-z0-9_-]+$/.test(token) || !host?.trim()) return null;
  try {
    const url = new URL(host.trim());
    if (
      url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/' || !url.hostname.includes('.')
    ) return null;
    return { projectToken: token, host: url.origin };
  } catch {
    return null;
  }
}

const screens = new Set([
  '/', '/decks', '/generate', '/progress', '/cards/[id]', '/categories',
  '/categories/[id]', '/decks/[id]', '/decks/new', '/friends', '/friends/[id]',
  '/insights', '/marketplace', '/marketplace/[id]', '/marketplace/downloads',
  '/review-settings', '/review', '/review/[id]',
]);

/** Expo route-file segments contain templates. Never send pathname, query, or route params. */
export function analyticsScreen(segments: readonly string[]): string | null {
  const parts = segments.filter((segment) => !/^\([^/]+\)$/.test(segment));
  if (parts.at(-1) === 'index') parts.pop();
  const screen = `/${parts.join('/')}`;
  // Profile includes sign-out, deletion/Apple authentication, and photo selection;
  // token screens can open StoreKit. Unknown routes fail closed as the app grows.
  return screens.has(screen) ? screen : null;
}

type CaptureEvent = Parameters<Exclude<NonNullable<PostHogOptions['before_send']>, unknown[]>>[0];

const safeProperties = new Set([
  'token', 'distinct_id', '$anon_distinct_id', '$device_id', '$session_id', '$window_id',
  '$screen_name', '$lib', '$lib_version', '$app_build', '$app_name', '$app_namespace',
  '$app_version', '$device_manufacturer', '$device_model', '$device_type', '$os_name',
  '$os_version', '$screen_width', '$screen_height', '$is_identified',
  'recollect_release', 'recollect_version', 'recollect_commit',
]);

export function filterAnalyticsEvent(event: CaptureEvent, allowed: boolean): CaptureEvent | null {
  if (!allowed) return null;
  // Replay payloads are produced and masked by the native SDK, not event properties.
  if (event.event === '$snapshot') return event;
  if (event.event !== '$screen' && event.event !== '$identify') return null;
  if (event.event === '$screen' && !screens.has(String(event.properties?.$screen_name))) return null;
  const properties: NonNullable<CaptureEvent['properties']> = { $geoip_disable: true };
  for (const [key, value] of Object.entries(event.properties ?? {})) {
    if (key === '$screen_name' && !screens.has(String(value))) continue;
    if (safeProperties.has(key) &&
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'))
      properties[key] = value;
  }
  // Do not forward person properties, raw URLs, local file paths, or arbitrary event content.
  return { event: event.event, uuid: event.uuid, timestamp: event.timestamp, properties };
}

export function analyticsOptions(config: AnalyticsConfig, canCapture: () => boolean): PostHogOptions {
  return {
    host: config.host,
    defaultOptIn: false,
    // Explicit starts after consent + account + route checks. Never start at SDK setup.
    enableSessionReplay: false,
    captureAppLifecycleEvents: false,
    capturePushNotificationSubscriptions: false,
    capturePushNotificationOpened: false,
    disableSurveys: true,
    disableGeoip: true,
    errorTracking: { autocapture: false, exceptionSteps: { enabled: false } },
    rageClickConfig: { enabled: false },
    sessionReplayConfig: {
      maskAllTextInputs: true,
      maskAllImages: true,
      maskAllSandboxedViews: true,
      captureLog: false,
      captureNetworkTelemetry: false,
      captureTouches: false,
      sampleRate: 1,
      throttleDelayMs: 1000,
      screenshotScale: 0.5,
      screenshotColorMode: 'RGB_565',
      screenshotCompressionQuality: 30,
    },
    before_send: (event) => filterAnalyticsEvent(event, canCapture()),
  };
}
