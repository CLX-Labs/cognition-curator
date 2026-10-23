import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DeckShare } from '@recollect/contracts';

const rig = vi.hoisted(() => ({ ownerId: 'owner-a' as string | null, focused: true }));
vi.mock('../src/store', () => ({
  useStore: () => ({ session: rig.ownerId ? { user: { id: rig.ownerId } } : null }),
}));
vi.mock('../src/api', () => ({ api: { request: vi.fn() }, ApiError: class extends Error {} }));
vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => (() => void) | void) =>
    React.useEffect(() => (rig.focused ? callback() : undefined), [callback, rig.focused]),
}));
import { progressVisible, useCommunityResource } from '../src/community-api';

let renderer: ReactTestRenderer | null = null;
let resource: ReturnType<typeof useCommunityResource<string>>;
function Probe({ load }: { load(ownerId: string): Promise<string> }) {
  resource = useCommunityResource('test', load);
  return React.createElement('result', {
    data: resource.data,
    error: resource.error,
    busy: resource.busy,
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
beforeEach(() => {
  rig.ownerId = 'owner-a';
  rig.focused = true;
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = null;
});

it('discards an old account response even when it resolves after the next account read', async () => {
  const first = deferred<string>();
  const second = deferred<string>();
  const load = vi.fn((owner: string) => (owner === 'owner-a' ? first.promise : second.promise));
  await act(async () => {
    renderer = create(React.createElement(Probe, { load }));
  });
  rig.ownerId = 'owner-b';
  await act(async () => {
    renderer!.update(React.createElement(Probe, { load }));
  });
  expect(resource.data).toBeNull();
  await act(async () => {
    second.resolve('B’s private connections');
  });
  await act(async () => {
    first.resolve('A’s private connections');
  });
  expect(resource.data).toBe('B’s private connections');
  expect(load.mock.calls.map(([owner]) => owner)).toEqual(['owner-a', 'owner-b']);
});

it('does not finish a blurred mutation or duplicate a rapidly tapped action', async () => {
  const load = vi.fn(async () => 'connections');
  await act(async () => {
    renderer = create(React.createElement(Probe, { load }));
  });
  const pending = deferred<string>();
  const action = vi.fn(() => pending.promise);
  let first!: Promise<string | null>;
  let duplicate!: Promise<string | null>;
  await act(async () => {
    first = resource.run('invite', action);
    duplicate = resource.run('invite', action);
  });
  expect(action).toHaveBeenCalledTimes(1);
  expect(await duplicate).toBeNull();
  rig.focused = false;
  await act(async () => {
    renderer!.update(React.createElement(Probe, { load }));
  });
  await act(async () => {
    pending.resolve('one-use-invite');
  });
  expect(await first).toBeNull();
  rig.focused = true;
  await act(async () => {
    renderer!.update(React.createElement(Probe, { load }));
  });
  expect(resource.busy).toBeNull();
  expect(load).toHaveBeenCalledTimes(2);
});

it('never grants recall visibility to a user outside the two share participants', () => {
  const share = {
    sender: { id: 'sender' },
    recipient: { id: 'recipient' },
    senderSharesProgress: true,
    recipientSharesProgress: false,
  } as DeckShare;
  expect(progressVisible(share, 'sender')).toBe(true);
  expect(progressVisible(share, 'recipient')).toBe(false);
  expect(progressVisible(share, 'stranger')).toBe(false);
});

it('does not execute an action retained from a different signed-in account', async () => {
  const load = vi.fn(async () => 'connections');
  await act(async () => {
    renderer = create(React.createElement(Probe, { load }));
  });
  const previousRun = resource.run;
  rig.ownerId = 'owner-b';
  await act(async () => {
    renderer!.update(React.createElement(Probe, { load }));
  });
  const action = vi.fn(async () => 'sensitive action');
  expect(await previousRun('share', action)).toBeNull();
  expect(action).not.toHaveBeenCalled();
});
