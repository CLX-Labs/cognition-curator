import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Profile, Session } from '@recollect/contracts';
import type { Repository } from '../src/repository';

const rig = vi.hoisted(() => ({
  session: null as Session | null,
  repository: null as Repository | null,
  request: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  cache: new Map<string, unknown>(),
  listeners: new Set<(state: string) => void>(),
}));
vi.mock('../src/api', () => ({ api: { request: (...args: unknown[]) => rig.request(...args) } }));
vi.mock('../src/store', () => ({
  useStore: () => ({ session: rig.session, repository: rig.repository }),
}));
vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: (_event: string, listener: (state: string) => void) => {
      rig.listeners.add(listener);
      return { remove: () => rig.listeners.delete(listener) };
    },
  },
}));
import { ProfileProvider, useProfile } from '../src/profile';

const ownerA = '00000000-0000-4000-8000-000000000001';
const ownerB = '00000000-0000-4000-8000-000000000002';
const photo = 'data:image/jpeg;base64,/9j/2Q==';
const profile = (id = ownerA): Profile => ({
  id,
  name: id === ownerA ? 'Nico' : 'Alex',
  photoDataUrl: null,
});
let state: ReturnType<typeof useProfile>;
let renderer: ReactTestRenderer | null = null;
function Consumer() {
  state = useProfile();
  return null;
}
function switchOwner(id: string) {
  rig.session = {
    user: { id, name: 'Original', email: null },
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt: '2027-01-01T00:00:00Z',
  };
  rig.repository = {
    ownerId: id,
    getState: async () => rig.cache.get(id) ?? null,
    setState: async (_key: string, value: unknown) => {
      rig.cache.set(id, value);
    },
  } as unknown as Repository;
}
function tree() {
  return React.createElement(ProfileProvider, { children: React.createElement(Consumer) });
}
async function mount() {
  await act(async () => {
    renderer = create(tree());
  });
}
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  rig.cache.clear();
  rig.listeners.clear();
  rig.request.mockReset();
  switchOwner(ownerA);
  rig.request.mockResolvedValue(profile());
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

it('saves a name and photo to the owner cache and shows them immediately', async () => {
  await mount();
  const updated = { ...profile(), name: 'Nicholas', photoDataUrl: photo };
  rig.request.mockResolvedValueOnce(updated);
  await act(async () => state.save({ name: 'Nicholas', photoDataUrl: photo }));
  expect(rig.request).toHaveBeenLastCalledWith('/v1/profile', {
    method: 'PATCH',
    body: { name: 'Nicholas', photoDataUrl: photo },
    ownerId: ownerA,
  });
  expect(state.profile).toEqual(updated);
  expect(rig.cache.get(ownerA)).toEqual(updated);
});

it('uses the cached profile offline and preserves it when saving fails', async () => {
  const cached = { ...profile(), photoDataUrl: photo };
  rig.cache.set(ownerA, cached);
  rig.request.mockRejectedValue(new Error('Offline'));
  await mount();
  expect(state.profile).toEqual(cached);
  expect(state.loading).toBe(false);
  expect(state.error).toBe('Offline');
  await act(async () => {
    await expect(state.save({ name: 'Unsaved' })).rejects.toThrow('Offline');
  });
  expect(state.profile).toEqual(cached);
  expect(rig.cache.get(ownerA)).toEqual(cached);
});

it('does not let an earlier profile fetch overwrite a successful save', async () => {
  await mount();
  const pending = deferred();
  rig.request.mockImplementationOnce(() => pending.promise);
  let fetching!: Promise<void>;
  await act(async () => {
    fetching = state.refresh(true);
  });
  const saved = { ...profile(), name: 'Saved latest', photoDataUrl: photo };
  rig.request.mockResolvedValueOnce(saved);
  await act(async () => state.save({ name: saved.name, photoDataUrl: photo }));
  await act(async () => {
    pending.resolve(profile());
    await fetching;
  });
  expect(state.profile).toEqual(saved);
  expect(rig.cache.get(ownerA)).toEqual(saved);
});

it('never displays or caches a late response from the previous signed-in account', async () => {
  const pending = deferred();
  rig.request.mockImplementationOnce(() => pending.promise);
  await mount();
  switchOwner(ownerB);
  rig.request.mockResolvedValueOnce(profile(ownerB));
  await act(async () => renderer!.update(tree()));
  await act(async () => {
    pending.resolve({ ...profile(), photoDataUrl: photo });
  });
  expect(state.profile).toEqual(profile(ownerB));
  expect(rig.cache.get(ownerB)).toEqual(profile(ownerB));
  expect(rig.cache.has(ownerA)).toBe(false);
});

it('coalesces profile refreshes and never polls during background library sync', async () => {
  await mount();
  rig.request.mockClear();
  const pending = deferred();
  rig.request.mockImplementationOnce(() => pending.promise);
  let first!: Promise<void>, second!: Promise<void>;
  await act(async () => {
    first = state.refresh(true);
    second = state.refresh(true);
  });
  expect(first).toBe(second);
  expect(rig.request).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending.resolve(profile());
    await first;
  });
  await act(async () => {
    renderer!.update(tree());
    for (const listener of rig.listeners) {
      listener('background');
      listener('active');
    }
  });
  expect(rig.request).toHaveBeenCalledTimes(1);
});

it('finishes loading after React Strict Mode checks mount cleanup and remount', async () => {
  await act(async () => {
    renderer = create(React.createElement(React.StrictMode, null, tree()));
  });
  expect(state.loading).toBe(false);
  expect(state.profile).toEqual(profile());
  expect(state.error).toBeNull();
});
