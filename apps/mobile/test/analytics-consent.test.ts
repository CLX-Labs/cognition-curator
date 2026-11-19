import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const rig = vi.hoisted(() => ({ repository: null as any }));
vi.mock('../src/store', () => ({ useStore: () => ({ repository: rig.repository }) }));
vi.mock('../src/ui', () => {
  const host =
    (name: string) =>
    ({ children, ...props }: any) =>
      React.createElement(name, props, children);
  return { Button: host('button'), Panel: host('panel'), Text: host('text'), s: {} };
});

import {
  ANALYTICS_CONSENT_KEY,
  AnalyticsConsentPanel,
  AnalyticsConsentProvider,
  useAnalyticsConsent,
} from '../src/analytics-consent';

const granted = {
  provider: 'PostHog',
  version: 1,
  allowed: true,
  grantedAt: '2026-11-19T12:00:00.000Z',
};
let renderer: ReactTestRenderer | null = null;
let consent!: ReturnType<typeof useAnalyticsConsent>;
const renders: Array<{ owner: string | null; allowed: boolean; loaded: boolean }> = [];

function repository(ownerId = 'first', initial: unknown = null) {
  let saved = initial;
  return {
    ownerId,
    getState: vi.fn(async (_key: string) => saved),
    setState: vi.fn(async (_key: string, value: unknown) => {
      saved = value;
    }),
    saved: () => saved,
  };
}
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function Probe() {
  consent = useAnalyticsConsent();
  renders.push({
    owner: rig.repository?.ownerId ?? null,
    allowed: consent.allowed,
    loaded: consent.loaded,
  });
  return React.createElement(AnalyticsConsentPanel);
}
function tree() {
  return React.createElement(AnalyticsConsentProvider, null, React.createElement(Probe));
}
async function mount() {
  await act(async () => {
    renderer = create(tree());
  });
}
async function switchRepository(next: ReturnType<typeof repository> | null) {
  rig.repository = next;
  await act(async () => renderer!.update(tree()));
}
const button = () => renderer!.root.findByType('button');

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  rig.repository = repository();
  renders.length = 0;
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

it.each([
  null,
  true,
  { allowed: true },
  { ...granted, provider: 'Other' },
  { ...granted, version: 2 },
  { ...granted, allowed: false },
  { ...granted, grantedAt: 'not a date' },
])('defaults off unless this repository has valid explicit permission: %j', async (saved) => {
  rig.repository = repository('first', saved);
  await mount();
  expect(consent).toMatchObject({ allowed: false, loaded: true, busy: false, error: null });
  expect(rig.repository.getState).toHaveBeenCalledWith(ANALYTICS_CONSENT_KEY);
  expect(rig.repository.setState).not.toHaveBeenCalled();
});

it('loads saved permission for this account and explains the optional masked sharing in settings', async () => {
  rig.repository = repository('first', granted);
  await mount();
  expect(consent.allowed).toBe(true);
  expect(button().props.title).toBe('Disable analytics & replay');
  const text = renderer!.root.findAllByType('text').map((node) => node.children.join('')).join(' ');
  expect(text).toContain('App analytics & replay');
  expect(text).toContain('Optional usage events');
  expect(text).toContain('PostHog');
  expect(text).toContain('internal account ID');
  expect(text).toContain('text and images are masked and are not sent');
  expect(text).toContain('this device only');
  expect(text).toContain('disable it here anytime');
});

it('keeps permission off until an explicit opt-in has been persisted successfully', async () => {
  const pending = deferred<void>();
  rig.repository.setState.mockImplementation(() => pending.promise);
  await mount();
  const setAllowed = consent.setAllowed;
  let save!: Promise<void>;
  await act(async () => {
    save = consent.setAllowed(true);
  });
  expect(consent).toMatchObject({ allowed: false, loaded: true, busy: true });
  expect(consent.setAllowed).toBe(setAllowed);
  expect(rig.repository.setState).toHaveBeenCalledWith(
    ANALYTICS_CONSENT_KEY,
    expect.objectContaining({ provider: 'PostHog', version: 1, allowed: true }),
  );
  await act(async () => {
    pending.resolve();
    await save;
  });
  expect(consent).toMatchObject({ allowed: true, busy: false, error: null });
  expect(consent.setAllowed).toBe(setAllowed);
});

it('fails closed when loading permission or saving an opt-in fails', async () => {
  rig.repository.getState.mockRejectedValue(new Error('Read unavailable'));
  rig.repository.setState.mockRejectedValue(new Error('Save unavailable'));
  await mount();
  expect(consent).toMatchObject({ allowed: false, loaded: true, error: 'Read unavailable' });
  await act(async () => consent.setAllowed(true));
  expect(consent).toMatchObject({ allowed: false, busy: false, error: 'Save unavailable' });
});

it('revokes immediately and keeps a failed revocation off when switching away and back', async () => {
  const first = repository('first', granted);
  const pending = deferred<void>();
  first.setState.mockImplementation(() => pending.promise);
  rig.repository = first;
  await mount();
  expect(consent.allowed).toBe(true);
  let save!: Promise<void>;
  await act(async () => {
    save = consent.setAllowed(false);
  });
  expect(consent).toMatchObject({ allowed: false, busy: true });
  expect(first.setState).toHaveBeenCalledWith(ANALYTICS_CONSENT_KEY, null);
  await act(async () => {
    pending.reject(new Error('Disk full'));
    await save;
  });
  expect(consent).toMatchObject({ allowed: false, busy: false, error: 'Disk full' });
  await switchRepository(repository('second'));
  await switchRepository(repository('first', first.saved()));
  expect(consent).toMatchObject({ allowed: false, loaded: true });
  await act(async () => consent.setAllowed(true));
  expect(consent.allowed).toBe(true);
});

it('does not let a late stored grant overwrite a newer failed save', async () => {
  const read = deferred<unknown>();
  rig.repository.getState.mockImplementation(() => read.promise);
  rig.repository.setState.mockRejectedValue(new Error('Cannot save'));
  await mount();
  expect(consent).toMatchObject({ allowed: false, loaded: false });
  await act(async () => consent.setAllowed(true));
  await act(async () => read.resolve(granted));
  expect(consent).toMatchObject({ allowed: false, loaded: true, error: 'Cannot save' });
});

it.each(['different owner', 'new repository for the same owner'])(
  'gates permission on the first render and ignores old reads after a %s',
  async (transition) => {
    const oldRead = deferred<unknown>();
    const newRead = deferred<unknown>();
    rig.repository.getState.mockImplementation(() => oldRead.promise);
    await mount();
    const next = repository(transition === 'different owner' ? 'second' : 'first');
    next.getState.mockImplementation(() => newRead.promise);
    await switchRepository(next);
    await act(async () => oldRead.resolve(granted));
    expect(consent).toMatchObject({ allowed: false, loaded: false });
    await act(async () => newRead.resolve(null));
    expect(consent).toMatchObject({ allowed: false, loaded: true });
    expect(renders.every((render) => !render.allowed)).toBe(true);
  },
);

it('removes an active grant synchronously when changing repositories or signing out', async () => {
  rig.repository = repository('first', granted);
  await mount();
  const pending = deferred<unknown>();
  const next = repository('second');
  next.getState.mockImplementation(() => pending.promise);
  renders.length = 0;
  await switchRepository(next);
  expect(renders[0]).toEqual({ owner: 'second', allowed: false, loaded: false });
  await switchRepository(null);
  expect(consent).toMatchObject({ allowed: false, loaded: false, busy: false });
  expect(button().props.disabled).toBe(true);
  await act(async () => pending.resolve(granted));
  expect(consent.allowed).toBe(false);
});

it('ignores late opt-in completion and stale callbacks across an A to B to A transition', async () => {
  const first = rig.repository;
  const pending = deferred<void>();
  first.setState.mockImplementation(() => pending.promise);
  await mount();
  const oldSetAllowed = consent.setAllowed;
  let save!: Promise<void>;
  await act(async () => {
    save = oldSetAllowed(true);
  });
  await switchRepository(repository('second'));
  await switchRepository(first);
  await act(async () => {
    pending.resolve();
    await save;
    await oldSetAllowed(true);
  });
  expect(consent).toMatchObject({ allowed: false, busy: false });
  expect(first.setState).toHaveBeenCalledOnce();
});

it('persists a revocation after an in-flight opt-in without granting while either save completes', async () => {
  const first = rig.repository;
  const pending = deferred<void>();
  const write = first.setState.getMockImplementation()!;
  first.setState.mockImplementationOnce(async (key: string, value: unknown) => {
    await pending.promise;
    await write(key, value);
  });
  await mount();
  let enable!: Promise<void>;
  await act(async () => {
    enable = consent.setAllowed(true);
  });
  // A replacement repository still writes to the same account's local preference.
  await switchRepository({ ...first });
  let disable!: Promise<void>;
  await act(async () => {
    disable = consent.setAllowed(false);
  });
  expect(first.setState).toHaveBeenCalledOnce();
  await act(async () => {
    pending.resolve();
    await Promise.all([enable, disable]);
  });
  expect(first.setState).toHaveBeenLastCalledWith(ANALYTICS_CONSENT_KEY, null);
  expect(first.saved()).toBeNull();
  expect(consent).toMatchObject({ allowed: false, loaded: true, busy: false });
  expect(renders.every((render) => !render.allowed)).toBe(true);
});

it('invalidates the first permission read during StrictMode effect replay', async () => {
  const firstRead = deferred<unknown>();
  rig.repository.getState.mockImplementationOnce(() => firstRead.promise);
  await act(async () => {
    renderer = create(React.createElement(React.StrictMode, null, tree()));
  });
  expect(rig.repository.getState).toHaveBeenCalledTimes(2);
  await act(async () => firstRead.resolve(granted));
  expect(consent).toMatchObject({ allowed: false, loaded: true });
});
