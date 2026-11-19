import { describe, expect, it, vi } from 'vitest';
import {
  analyticsConfig,
  analyticsOptions,
  analyticsScreen,
  filterAnalyticsEvent,
} from '../src/analytics-config';

type CaptureEvent = Parameters<typeof filterAnalyticsEvent>[0];
const projectToken = `phc_${'a'.repeat(43)}`;
const config = { projectToken, host: 'https://us.i.posthog.com' };
const screenEvent = (): CaptureEvent => ({
  event: '$screen',
  properties: { token: projectToken, distinct_id: 'internal-account-id', $screen_name: '/decks' },
});

describe('public analytics configuration', () => {
  it('normalizes an explicitly configured public project token and HTTPS ingestion origin', () => {
    expect(analyticsConfig(` ${projectToken}\n`, ' https://US.i.posthog.com/ ')).toEqual(config);
    expect(analyticsConfig(projectToken, 'https://analytics.example.test:8443')).toEqual({
      projectToken,
      host: 'https://analytics.example.test:8443',
    });
  });

  it.each([undefined, '', '  ', 'phx_personal-secret', 'personal-secret', 'phc_', 'phc_a b', 'phc_a\nb'])(
    'fails closed for a missing, secret, or malformed project token: %j',
    (token) => {
      expect(analyticsConfig(token, config.host)).toBeNull();
    },
  );

  it.each([
    undefined,
    '',
    '   ',
    'not a URL',
    'http://us.i.posthog.com',
    'wss://us.i.posthog.com',
    'https://localhost',
    'https://user@us.i.posthog.com',
    'https://user:secret@us.i.posthog.com',
    'https://us.i.posthog.com/capture',
    'https://us.i.posthog.com/?email=private@example.test',
    'https://us.i.posthog.com/#private-fragment',
  ])('fails closed for an absent or non-origin HTTPS host: %j', (host) => {
    expect(analyticsConfig(projectToken, host)).toBeNull();
  });
});

describe('screen privacy boundary', () => {
  it.each([
    { segments: [], expected: '/' },
    { segments: ['(tabs)', 'index'], expected: '/' },
    { segments: ['(tabs)', 'decks'], expected: '/decks' },
    { segments: ['(tabs)', 'generate'], expected: '/generate' },
    { segments: ['(tabs)', 'progress'], expected: '/progress' },
    { segments: ['cards', '[id]'], expected: '/cards/[id]' },
    { segments: ['categories', 'index'], expected: '/categories' },
    { segments: ['categories', '[id]'], expected: '/categories/[id]' },
    { segments: ['decks', '[id]'], expected: '/decks/[id]' },
    { segments: ['decks', 'new'], expected: '/decks/new' },
    { segments: ['friends'], expected: '/friends' },
    { segments: ['friends', '[id]'], expected: '/friends/[id]' },
    { segments: ['insights'], expected: '/insights' },
    { segments: ['marketplace', 'index'], expected: '/marketplace' },
    { segments: ['marketplace', '[id]'], expected: '/marketplace/[id]' },
    { segments: ['marketplace', 'downloads'], expected: '/marketplace/downloads' },
    { segments: ['review-settings'], expected: '/review-settings' },
    { segments: ['review'], expected: '/review' },
    { segments: ['review', '[id]'], expected: '/review/[id]' },
  ])('emits an allowlisted route template for $segments', ({ segments, expected }) => {
    expect(analyticsScreen(Object.freeze(segments))).toBe(expected);
  });

  it.each([
    ['(tabs)', 'profile'],
    ['tokens'],
    ['login'],
    ['auth', 'callback'],
    ['account', 'deletion'],
    ['new-feature'],
    ['decks', 'private-deck-id'],
    ['cards', 'private-card-id'],
    ['friends', 'private-account-id'],
    ['marketplace', 'private-search?query=card-content'],
    ['review', '[id]', 'private-extra-segment'],
    ['/decks/private-deck-id'],
  ])('rejects sensitive, unknown, and resolved routes: %j', (...segments) => {
    expect(analyticsScreen(segments)).toBeNull();
  });
});

describe('event privacy boundary', () => {
  it.each(['$screen', '$identify', '$snapshot', 'card_created'])(
    'drops %s before consent, including native replay events',
    (event) => {
      expect(filterAnalyticsEvent({ ...screenEvent(), event }, false)).toBeNull();
    },
  );

  it.each([
    '$autocapture',
    '$exception',
    '$pageview',
    '$groupidentify',
    '$create_alias',
    '$feature_flag_called',
    'Application Opened',
    'card_created',
  ])('rejects unsolicited SDK and content event types after consent: %s', (event) => {
    expect(filterAnalyticsEvent({ ...screenEvent(), event }, true)).toBeNull();
  });

  it.each([
    undefined,
    '',
    '/profile',
    '/tokens',
    '/decks/private-deck-id',
    '/cards/private-card-id',
    '/decks?title=private-deck-title',
    'https://app.example.test/decks/private-deck-id',
  ])('rejects a non-template screen name: %j', (name) => {
    expect(
      filterAnalyticsEvent({ event: '$screen', properties: { $screen_name: name } }, true),
    ).toBeNull();
  });

  it.each(['$screen', '$identify'])(
    'keeps account/release/device metadata but removes content and person properties from %s',
    (event) => {
      const timestamp = new Date('2026-11-19T12:00:00Z');
      const safe = {
        token: projectToken,
        distinct_id: 'internal-account-id',
        $screen_name: '/decks/[id]',
        $session_id: 'random-session-id',
        $lib: 'posthog-react-native',
        $app_version: '2.0.0',
        $screen_height: 844,
        $is_identified: true,
        recollect_release: 'production-release',
        recollect_version: '2.0.0',
        recollect_commit: 'abcdef0123',
      };
      const source = {
        event,
        uuid: '00000000-0000-4000-8000-000000000001',
        timestamp,
        $set: { email: 'private@example.test', name: 'Private Learner' },
        $set_once: { original_name: 'Private Learner' },
        private_top_level: 'private-card-question',
        properties: Object.freeze({
          ...safe,
          email: 'private@example.test',
          name: 'Private Learner',
          front: 'private-card-question',
          back: 'private-card-answer',
          prompt: 'private-generation-prompt',
          deck_title: 'private-deck-title',
          $current_url: 'https://app.example.test/decks/private-deck-id',
          $pathname: '/decks/private-deck-id',
          file_uri: 'file:///private/profile-photo.jpg',
          $set: { email: 'private@example.test' },
          $set_once: { name: 'Private Learner' },
          $device_model: { private: 'private-card-question' },
          $screen_width: ['private-card-answer'],
          $os_name: null,
          $geoip_disable: false,
        }),
      };
      Object.freeze(source);
      const output = filterAnalyticsEvent(source, true);
      expect(output).toEqual({
        event,
        uuid: source.uuid,
        timestamp,
        properties: { $geoip_disable: true, ...safe },
      });
      expect(output).not.toBe(source);
      expect(source.properties.front).toBe('private-card-question');
      expect(JSON.stringify(output)).not.toContain('private');
    },
  );

  it('preserves the native masked snapshot payload after eligibility has been checked', () => {
    const nativeSnapshot: CaptureEvent = {
      event: '$snapshot',
      properties: {
        distinct_id: 'internal-account-id',
        $session_id: 'random-session-id',
        $snapshot_data: [{ type: 2, data: { masked: true, wireframes: [] } }],
      },
    };
    expect(filterAnalyticsEvent(nativeSnapshot, true)).toBe(nativeSnapshot);
    expect(filterAnalyticsEvent(nativeSnapshot, false)).toBeNull();
  });
});

describe('SDK capture defaults', () => {
  it('starts opted out with replay and independent native capture paths disabled', () => {
    const options = analyticsOptions(config, () => false);
    expect(options).toMatchObject({
      host: config.host,
      defaultOptIn: false,
      enableSessionReplay: false,
      captureAppLifecycleEvents: false,
      capturePushNotificationSubscriptions: false,
      capturePushNotificationOpened: false,
      disableSurveys: true,
      disableGeoip: true,
      errorTracking: { autocapture: false, exceptionSteps: { enabled: false } },
      rageClickConfig: { enabled: false },
    });
    expect(options.sessionReplayConfig).toMatchObject({
      maskAllTextInputs: true,
      maskAllImages: true,
      maskAllSandboxedViews: true,
      captureLog: false,
      captureNetworkTelemetry: false,
      captureTouches: false,
    });
  });

  it('checks current consent/eligibility for every outgoing event instead of retaining an old grant', () => {
    let allowed = false;
    const canCapture = vi.fn(() => allowed);
    const hook = analyticsOptions(config, canCapture).before_send;
    if (typeof hook !== 'function') throw new Error('Expected an installed event filter');
    expect(hook(screenEvent())).toBeNull();
    allowed = true;
    expect(hook(screenEvent())).toMatchObject({
      event: '$screen',
      properties: { $screen_name: '/decks', $geoip_disable: true },
    });
    allowed = false;
    expect(hook({ event: '$snapshot', properties: { $snapshot_data: [] } })).toBeNull();
    expect(canCapture).toHaveBeenCalledTimes(3);
  });
});
