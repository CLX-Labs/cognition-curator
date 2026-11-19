import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppStateStatus } from 'react-native';
import type { PostHogOptions } from 'posthog-react-native';

type StoreSnapshot = {
  ready: boolean;
  session: { user: { id: string } } | null;
  repository: { ownerId: string } | null;
  deletionBusy: boolean;
  deletionRecovery: { ownerId: string; localCleared: boolean } | null;
  initializationError: string | null;
};
const rig = vi.hoisted(() => ({
  store: {} as StoreSnapshot,
  consent: { loaded: true, allowed: true },
  segments: ['(tabs)', 'decks'] as string[],
  appState: 'active' as AppStateStatus,
  platform: 'ios',
  listener: null as ((state: AppStateStatus) => void) | null,
  remove: vi.fn(),
  construct: vi.fn<(token: string, options: PostHogOptions) => void>(),
  client: {
    identify: vi.fn<(owner: string) => void>(),
    register: vi.fn<() => Promise<void>>(),
    screen: vi.fn<(name: string, properties: Record<string, string>) => Promise<void>>(),
    reset: vi.fn<() => void>(),
    optIn: vi.fn<() => Promise<void>>(),
    optOut: vi.fn<() => Promise<void>>(),
    startSessionRecording: vi.fn<(resume?: boolean) => Promise<void>>(),
    stopSessionRecording: vi.fn<() => Promise<void>>(),
    isSessionRecordingActive: vi.fn<() => Promise<boolean>>(),
  },
}));
vi.mock('../src/store', () => ({ useStore: () => rig.store }));
vi.mock('../src/analytics-consent', () => ({ useAnalyticsConsent: () => rig.consent }));
vi.mock('../src/release', () => ({
  release: { id: 'release-test', version: '1.2.3', commit: 'public-commit' },
}));
vi.mock('expo-router', () => ({ useSegments: () => rig.segments }));
vi.mock('react-native', () => ({
  AppState: {
    get currentState() { return rig.appState; },
    addEventListener: (_name: string, listener: (state: AppStateStatus) => void) => {
      rig.listener = listener;
      return { remove: rig.remove };
    },
  },
  Platform: { get OS() { return rig.platform; } },
}));
vi.mock('@posthog/react-native-plugin', () => ({
  isEnabled: () => rig.client.isSessionRecordingActive(),
}));
vi.mock('posthog-react-native', () => ({
  default: class {
    constructor(token: string, options: PostHogOptions) {
      rig.construct(token, options);
      return rig.client;
    }
  },
}));

let renderer: ReactTestRenderer | null = null;
let Observer: typeof import('../src/analytics')['AnalyticsObserver'];
const eligibleStore = (): StoreSnapshot => ({
  ready: true,
  session: { user: { id: 'account-a' } },
  repository: { ownerId: 'account-a' },
  deletionBusy: false,
  deletionRecovery: null,
  initializationError: null,
});
async function mount() {
  Observer = (await import('../src/analytics')).AnalyticsObserver;
  await act(async () => { renderer = create(React.createElement(Observer)); });
}
async function render() {
  await act(async () => { renderer!.update(React.createElement(Observer)); });
}
function screenEvent() {
  const beforeSend = rig.construct.mock.calls[0]![1].before_send;
  if (typeof beforeSend !== 'function') throw new Error('Missing SDK capture filter.');
  return beforeSend({ event: '$screen', properties: { $screen_name: '/decks' } });
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('__DEV__', false);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubEnv('EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN', 'phc_public-test');
  vi.stubEnv('EXPO_PUBLIC_POSTHOG_HOST', 'https://us.i.posthog.com');
  vi.stubEnv('EXPO_PUBLIC_POSTHOG_ENABLE_DEV', 'false');
  rig.store = eligibleStore();
  rig.consent = { loaded: true, allowed: true };
  rig.segments = ['(tabs)', 'decks'];
  rig.appState = 'active';
  rig.platform = 'ios';
  rig.listener = null;
  rig.remove.mockClear();
  rig.construct.mockClear();
  rig.client.identify.mockReset();
  rig.client.reset.mockReset();
  rig.client.register.mockReset().mockResolvedValue(undefined);
  rig.client.screen.mockReset().mockResolvedValue(undefined);
  rig.client.optIn.mockReset().mockResolvedValue(undefined);
  rig.client.optOut.mockReset().mockResolvedValue(undefined);
  rig.client.startSessionRecording.mockReset().mockResolvedValue(undefined);
  rig.client.stopSessionRecording.mockReset().mockResolvedValue(undefined);
  rig.client.isSessionRecordingActive.mockReset().mockResolvedValue(false);
});
afterEach(async () => {
  await act(async () => { renderer?.unmount(); });
  renderer = null;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('analytics observer integration', () => {
  it.each([
    ['missing token', () => vi.stubEnv('EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN', '')],
    ['missing host', () => vi.stubEnv('EXPO_PUBLIC_POSTHOG_HOST', '')],
    ['insecure host', () => vi.stubEnv('EXPO_PUBLIC_POSTHOG_HOST', 'http://us.i.posthog.com')],
    ['development without explicit enable', () => vi.stubGlobal('__DEV__', true)],
    ['unsupported platform', () => { rig.platform = 'web'; }],
    ['Android pending native stop-status support', () => { rig.platform = 'android'; }],
    ['initially inactive app', () => { rig.appState = 'inactive'; }],
  ] as const)('never creates an SDK for %s', async (_name, disable) => {
    disable();
    await mount();
    expect(rig.construct).not.toHaveBeenCalled();
    expect(rig.client.optIn).not.toHaveBeenCalled();
    expect(rig.client.startSessionRecording).not.toHaveBeenCalled();
  });

  it('constructs one opt-out-by-default, manually controlled SDK after eligibility and explicit development enable', async () => {
    vi.stubGlobal('__DEV__', true);
    vi.stubEnv('EXPO_PUBLIC_POSTHOG_ENABLE_DEV', 'true');
    await mount();
    expect(rig.construct).toHaveBeenCalledTimes(1);
    expect(rig.construct.mock.calls[0]![0]).toBe('phc_public-test');
    expect(rig.construct.mock.calls[0]![1]).toMatchObject({
      defaultOptIn: false,
      enableSessionReplay: false,
      captureAppLifecycleEvents: false,
      capturePushNotificationSubscriptions: false,
      capturePushNotificationOpened: false,
      disableSurveys: true,
      disableGeoip: true,
      errorTracking: { autocapture: false, exceptionSteps: { enabled: false } },
      sessionReplayConfig: {
        maskAllTextInputs: true,
        maskAllImages: true,
        maskAllSandboxedViews: true,
        captureLog: false,
        captureNetworkTelemetry: false,
        captureTouches: false,
      },
    });
    expect(rig.client.identify).toHaveBeenCalledExactlyOnceWith('account-a');
    expect(rig.client.startSessionRecording).toHaveBeenCalledExactlyOnceWith(false);
    expect(rig.client.screen).toHaveBeenCalledExactlyOnceWith('/decks', {
      recollect_release: 'release-test',
      recollect_version: '1.2.3',
      recollect_commit: 'public-commit',
    });
    expect(screenEvent()).not.toBeNull();
    await render();
    expect(rig.client.screen).toHaveBeenCalledTimes(1);
    expect(rig.client.startSessionRecording).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['consent still loading', () => { rig.consent = { loaded: false, allowed: true }; }],
    ['consent revoked', () => { rig.consent = { loaded: true, allowed: false }; }],
    ['signed out', () => { rig.store.session = null; }],
    ['repository belongs to another account', () => { rig.store.repository = { ownerId: 'account-b' }; }],
    ['store still initializing', () => { rig.store.ready = false; }],
    ['account deletion pending', () => { rig.store.deletionBusy = true; }],
    ['local deletion cleanup pending', () => {
      rig.store.deletionRecovery = { ownerId: 'old-account', localCleared: false };
    }],
    ['current account deletion recovery', () => {
      rig.store.deletionRecovery = { ownerId: 'account-a', localCleared: true };
    }],
    ['initialization failed', () => { rig.store.initializationError = 'Cannot load account'; }],
  ] as const)('keeps analytics off for %s and stops an existing recording when it occurs', async (_name, disable) => {
    disable();
    await mount();
    expect(rig.construct).not.toHaveBeenCalled();

    rig.store = eligibleStore();
    rig.consent = { loaded: true, allowed: true };
    await render();
    expect(rig.construct).toHaveBeenCalledTimes(1);
    expect(rig.client.startSessionRecording).toHaveBeenCalledTimes(1);
    expect(screenEvent()).not.toBeNull();

    disable();
    await render();
    expect(screenEvent()).toBeNull();
    expect(rig.client.stopSessionRecording).toHaveBeenCalled();
    expect(rig.client.optOut).toHaveBeenCalled();
    expect(rig.client.reset).toHaveBeenCalledTimes(1);
  });

  it('waits for matching account consent and repository, then resets before recording a new account', async () => {
    await mount();
    rig.store.session = { user: { id: 'account-b' } };
    rig.consent = { loaded: false, allowed: false };
    await render();
    expect(screenEvent()).toBeNull();
    expect(rig.client.identify).toHaveBeenCalledTimes(1);
    rig.store.repository = { ownerId: 'account-b' };
    await render();
    expect(rig.client.identify).toHaveBeenCalledTimes(1);
    rig.consent = { loaded: true, allowed: true };
    await render();
    expect(rig.construct).toHaveBeenCalledTimes(1);
    expect(rig.client.identify).toHaveBeenLastCalledWith('account-b');
    expect(rig.client.reset.mock.invocationCallOrder[0]).toBeLessThan(
      rig.client.identify.mock.invocationCallOrder[1]!,
    );
    expect(rig.client.startSessionRecording).toHaveBeenCalledTimes(2);
  });

  it('blocks profile, payment and unknown routes, and only emits known route templates', async () => {
    rig.segments = ['(tabs)', 'profile'];
    await mount();
    expect(rig.construct).not.toHaveBeenCalled();
    rig.segments = ['tokens'];
    await render();
    expect(rig.construct).not.toHaveBeenCalled();
    rig.segments = ['cards', 'private-card-id'];
    await render();
    expect(rig.construct).not.toHaveBeenCalled();

    rig.segments = ['cards', '[id]'];
    await render();
    expect(rig.client.screen.mock.calls[0]![0]).toBe('/cards/[id]');
    rig.segments = ['(tabs)', 'decks'];
    await render();
    expect(rig.client.screen.mock.calls[1]![0]).toBe('/decks');
    expect(rig.client.startSessionRecording).toHaveBeenCalledTimes(1);
    expect(rig.client.reset).not.toHaveBeenCalled();

    rig.segments = ['future-private-route'];
    await render();
    expect(screenEvent()).toBeNull();
    expect(rig.client.optOut).toHaveBeenCalled();
    expect(rig.client.reset).toHaveBeenCalledTimes(1);
    expect(rig.client.screen).toHaveBeenCalledTimes(2);
  });

  it('closes capture synchronously on inactivity before React renders, resumes in foreground, and stops on unmount', async () => {
    await mount();
    expect(screenEvent()).not.toBeNull();
    await act(async () => {
      rig.listener!('inactive');
      // This assertion runs inside the native callback turn, before React flushes.
      expect(screenEvent()).toBeNull();
      expect(rig.client.stopSessionRecording).toHaveBeenCalled();
      expect(rig.client.optOut).toHaveBeenCalled();
    });
    expect(rig.client.reset).toHaveBeenCalledTimes(1);
    await act(async () => { rig.listener!('active'); });
    expect(rig.client.startSessionRecording).toHaveBeenCalledTimes(2);
    expect(screenEvent()).not.toBeNull();
    await act(async () => { renderer!.unmount(); });
    renderer = null;
    expect(screenEvent()).toBeNull();
    expect(rig.remove).toHaveBeenCalledTimes(1);
    expect(rig.client.reset).toHaveBeenCalledTimes(2);
  });
});
