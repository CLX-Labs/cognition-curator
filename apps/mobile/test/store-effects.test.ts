import React, { useEffect, useLayoutEffect, useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Card, Deck, Session } from '@recollect/contracts';
import { initialSchedule } from '@recollect/scheduler';
import type { LocalSnapshot } from '../src/repository';
import type { AccountDeletionRecovery } from '../src/api';

const rig = vi.hoisted(() => ({
  session: null as Session | null,
  snapshots: new Map<string, LocalSnapshot>(),
  listeners: new Set<(state: string) => void>(),
  sessionListeners: new Set<(session: Session | null) => void>(),
  appState: 'active',
  request: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  initialized: vi.fn(),
  publishWidget: vi.fn(async () => {}),
  setWidgetOwner: vi.fn(async () => {}),
  fontsLoaded: true,
  fontError: null as Error | null,
  deletion: null as AccountDeletionRecovery | null,
  finishDeletion: vi.fn(async () => {}),
}));
vi.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return rig.appState;
    },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      rig.listeners.add(listener);
      return { remove: () => rig.listeners.delete(listener) };
    },
  },
  View: ({ children }: { children: React.ReactNode }) => React.createElement('view', {}, children),
  Text: ({ children }: { children: React.ReactNode }) => React.createElement('text', {}, children),
  ActivityIndicator: () => null,
  Platform: { OS: 'ios' },
}));
vi.mock('expo-font', () => ({ useFonts: () => [rig.fontsLoaded, rig.fontError] }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'device-id' }));
vi.mock('../src/database', () => ({ openDatabase: async () => ({}) }));
vi.mock('../src/api', () => ({
  api: {
    get session() {
      return rig.session;
    },
    subscribe: (listener: (session: Session | null) => void) => {
      rig.sessionListeners.add(listener);
      return () => rig.sessionListeners.delete(listener);
    },
    initialize: async () => rig.session,
    deletionRecovery: () => rig.deletion,
    requestAccountDeletion: async (
      ownerId: string,
      operationId: string,
      prepared: (record: AccountDeletionRecovery) => void,
    ) => {
      rig.deletion = { ownerId, operationId, localCleared: false };
      prepared(rig.deletion);
      rig.deletion = {
        ...rig.deletion,
        receipt: {
          requestId: operationId,
          ownerId,
          status: 'pending',
          requestedAt: new Date().toISOString(),
          completedAt: null,
          estimatedCompletionDays: null,
          actionRequired: 'none',
        },
      };
    },
    assertDeletionOwner: async (ownerId: string) => {
      if (rig.session && rig.session.user.id !== ownerId) throw new Error('account changed');
    },
    forgetDeletedAccount: async () => {
      rig.session = null;
      for (const listener of rig.sessionListeners) listener(null);
    },
    finishDeletionRecovery: async () => {
      await rig.finishDeletion();
      if (rig.deletion) rig.deletion = { ...rig.deletion, localCleared: true };
    },
    request: (...args: unknown[]) => rig.request(...args),
    logout: async () => {},
  },
}));
vi.mock('../modules/recollect-widget', () => ({
  publishWidget: rig.publishWidget,
  setWidgetOwner: rig.setWidgetOwner,
}));
vi.mock('../src/repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/repository')>();
  return {
    ...original,
    installationDeviceId: async () => 'device-id',
    eraseOwnerData: async () => {},
    Repository: class {
      constructor(
        _db: unknown,
        public ownerId: string,
      ) {}
      async initialize() {
        rig.initialized(this.ownerId);
      }
      async snapshot() {
        return structuredClone(rig.snapshots.get(this.ownerId) ?? empty());
      }
      async nextOperation() {
        return null;
      }
      async cursor() {
        return '0';
      }
      async applyChanges() {}
      retire() {}
      async retireAndDrain() {}
    },
  };
});
vi.mock('expo-router', () => {
  const Stack = () => React.createElement(Editor);
  Stack.Screen = () => null;
  return { Stack };
});
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../src/login', () => ({ default: () => React.createElement('signed-out') }));
vi.mock('../src/ui', () => ({
  colors: {},
  s: {},
  Text: ({ children }: { children: React.ReactNode }) => React.createElement('text', {}, children),
}));
vi.mock('../src/app-updates', () => ({
  AppUpdateProvider: ({ children }: { children: React.ReactNode }) => children,
  UpdateNotice: () => null,
}));
vi.mock('../src/profile', () => ({
  ProfileProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../src/account-deletion', () => ({
  AccountDeletionRecoveryScreen: () => React.createElement('deletion-recovery'),
}));
import RootLayout from '../app/_layout';
import { useStore } from '../src/store';
import { useAppActive, usePolling } from '../src/polling';

const empty = (): LocalSnapshot => ({
  decks: [],
  cards: [],
  reviews: [],
  pending: 0,
  issues: [],
});
const session = (id = 'owner-a'): Session => ({
  user: { id, name: 'Learner', email: null },
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: '2027-01-01T00:00:00Z',
});
let renderer: ReactTestRenderer | null = null;
let store: ReturnType<typeof useStore>;
let mounts = 0,
  renders = 0;
let statuses: string[] = [];
function Editor() {
  store = useStore();
  ++renders;
  statuses.push(store.syncState);
  const [draft, setDraft] = useState('original draft');
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    ++mounts;
  }, []);
  return React.createElement('input', {
    value: draft,
    revealed,
    onChange: (value: string) => setDraft(value),
    onClick: () => setRevealed((value) => !value),
  });
}
function emitState(state: string) {
  rig.appState = state;
  for (const listener of rig.listeners) listener(state);
}
function emitSession(next: Session) {
  rig.session = next;
  for (const listener of rig.sessionListeners) listener(next);
}
function deferred() {
  let resolve!: (value: unknown) => void, reject!: (error: Error) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const page = () => ({ cursor: '0', highWatermark: '0', changes: [], hasMore: false });
async function mount() {
  await act(async () => {
    renderer = create(React.createElement(RootLayout));
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-13T00:00:00Z'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mounts = 0;
  renders = 0;
  statuses = [];
  rig.appState = 'active';
  rig.fontsLoaded = true;
  rig.fontError = null;
  rig.session = session();
  rig.deletion = null;
  rig.finishDeletion.mockImplementation(async () => {});
  rig.snapshots.clear();
  rig.request.mockImplementation(async () => page());
});
afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = null;
  expect(rig.listeners.size).toBe(0);
  expect(rig.sessionListeners.size).toBe(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('three empty background syncs do not render, remount, shift loading state, or lose editor/review state', async () => {
  await mount();
  await act(async () => {
    renderer!.root.findByType('input').props.onChange('unsaved question');
    renderer!.root.findByType('input').props.onClick();
  });
  const before = renders,
    data = store.data,
    widgetWrites = rig.publishWidget.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(45_000);
  });
  expect(rig.request).toHaveBeenCalledTimes(4);
  expect(store.data).toBe(data);
  expect(renders).toBe(before);
  expect(mounts).toBe(1);
  expect(statuses).not.toContain('syncing');
  expect(renderer!.root.findByType('input').props.value).toBe('unsaved question');
  expect(renderer!.root.findByType('input').props.revealed).toBe(true);
  expect(rig.publishWidget).toHaveBeenCalledTimes(widgetWrites);
});

it('loads the library while fonts prepare and mounts navigation once fonts are ready', async () => {
  rig.fontsLoaded = false;
  await mount();
  expect(rig.initialized).toHaveBeenCalledTimes(1);
  expect(renderer!.root.findAllByType('input')).toHaveLength(0);
  rig.fontsLoaded = true;
  await act(async () => renderer!.update(React.createElement(RootLayout)));
  expect(renderer!.root.findAllByType('input')).toHaveLength(1);
  expect(mounts).toBe(1);
});

it('opens the library with fallback typography if bundled fonts fail to load', async () => {
  rig.fontsLoaded = false;
  rig.fontError = new Error('Font load failed');
  await mount();
  expect(renderer!.root.findAllByType('input')).toHaveLength(1);
  expect(mounts).toBe(1);
});

it('same-account token rotation preserves the repository and mounted navigation', async () => {
  await mount();
  const repository = store.repository;
  await act(async () => {
    emitSession({ ...session(), accessToken: 'renewed' });
  });
  expect(store.repository).toBe(repository);
  expect(rig.initialized).toHaveBeenCalledTimes(1);
  expect(mounts).toBe(1);
});

it('background/duplicate active events do not poll; a real resume performs one quiet sync', async () => {
  await mount();
  const initial = rig.request.mock.calls.length;
  await act(async () => {
    emitState('background');
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(rig.request).toHaveBeenCalledTimes(initial);
  await act(async () => {
    emitState('active');
    emitState('active');
  });
  expect(rig.request).toHaveBeenCalledTimes(initial + 1);
  expect(statuses).not.toContain('syncing');
  expect(mounts).toBe(1);
});

it('manual sync joins an ongoing background request and shows loading only for the manual action', async () => {
  await mount();
  const held = deferred();
  rig.request.mockImplementationOnce(() => held.promise);
  let background!: Promise<void>, manual!: Promise<void>;
  await act(async () => {
    background = store.sync({ silent: true });
  });
  expect(store.syncState).toBe('idle');
  await act(async () => {
    manual = store.sync();
  });
  expect(manual).toBe(background);
  expect(store.syncState).toBe('syncing');
  await act(async () => {
    held.resolve(page());
    await manual;
  });
  expect(store.syncState).toBe('idle');
  expect(mounts).toBe(1);
  expect(rig.request).toHaveBeenCalledTimes(2);
});

it('default sync resolves an offline pull while a strict caller joining the same flight rejects', async () => {
  await mount();
  const held = deferred();
  rig.request.mockImplementationOnce(() => held.promise);
  let background!: Promise<void>, strict!: Promise<void>;
  await act(async () => {
    background = store.sync({ silent: true });
    strict = store.sync({ throwOnError: true });
  });
  const strictResult = strict.then(
    () => null,
    (cause: Error) => cause.message,
  );
  await act(async () => {
    held.reject(new Error('Could not pull current cards'));
    await background;
  });
  expect(await strictResult).toBe('Could not pull current cards');
  await expect(background).resolves.toBeUndefined();
  expect(store.syncState).toBe('offline');
  expect(store.syncError).toBe('Could not pull current cards');
  expect(rig.request).toHaveBeenCalledTimes(2);
});

it('a late failure from a previous account cannot replace the new account with an error/loading screen', async () => {
  await mount();
  const held = deferred();
  rig.request.mockImplementationOnce(() => held.promise);
  let old!: Promise<void>;
  await act(async () => {
    old = store.sync({ silent: true });
  });
  await act(async () => {
    emitSession(session('owner-b'));
  });
  await act(async () => {
    held.reject(new Error('old account failed'));
    await old;
  });
  expect(store.repository?.ownerId).toBe('owner-b');
  expect(store.syncError).toBeNull();
  expect(store.initializationError).toBeNull();
  expect(mounts).toBe(2);
});
it('a new account signed in during final deletion recovery is not signed out or given a cleared widget', async () => {
  await mount();
  const held = deferred();
  rig.finishDeletion.mockImplementation(async () => {
    await held.promise;
  });
  let deletion!: Promise<void>;
  await act(async () => {
    deletion = store.requestAccountDeletion('owner-a');
  });
  expect(rig.deletion?.receipt?.status).toBe('pending');
  await act(async () => {
    emitSession(session('owner-b'));
  });
  await act(async () => {
    held.resolve(undefined);
    await deletion;
  });
  expect(store.session?.user.id).toBe('owner-b');
  expect(store.repository?.ownerId).toBe('owner-b');
  expect(rig.setWidgetOwner.mock.calls.at(-1)?.[0]).toBe('owner-b');
  expect(rig.publishWidget.mock.calls.at(-1)?.[0]).toMatchObject({ ownerId: 'owner-b' });
});

it('real library changes update the UI while preserving the mounted editor draft', async () => {
  await mount();
  await act(async () => {
    renderer!.root.findByType('input').props.onChange('keep my edit');
  });
  const prior = store.data;
  rig.snapshots.set('owner-a', { ...empty(), pending: 1 });
  await act(async () => {
    await store.refresh();
  });
  expect(store.data).not.toBe(prior);
  expect(store.data.pending).toBe(1);
  expect(mounts).toBe(1);
  expect(renderer!.root.findByType('input').props.value).toBe('keep my edit');
});

it('the clock still updates due-card state without a database edit or navigation remount', async () => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);
  const timestamp = new Date().toISOString();
  const deck: Deck = {
    id: 'deck',
    ownerId: 'owner-a',
    name: 'Literature',
    description: '',
    color: '',
    icon: '',
    isSilenced: false,
    silencedUntil: null,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  const card: Card = {
    id: 'card',
    ownerId: deck.ownerId,
    deckId: deck.id,
    front: 'Author?',
    back: 'Jane Austen',
    hint: '',
    explanation: '',
    tags: [],
    aiGenerated: false,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    schedule: initialSchedule(new Date(Date.now() + 60_000).toISOString()),
  };
  const future = {
    ...card,
    id: 'future-card',
    front: 'A future question',
    schedule: initialSchedule(new Date(Date.now() + 120_000).toISOString()),
  };
  rig.snapshots.set('owner-a', { ...empty(), decks: [deck], cards: [card, future] });
  await mount();
  const before = store.data;
  expect(rig.publishWidget.mock.calls.at(-1)?.[0]).toMatchObject({
    dueCount: 0,
    hasCards: true,
    topCard: { id: future.id, question: future.front },
  });
  const writes = rig.publishWidget.mock.calls.length;
  const selections = random.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(45_000);
  });
  expect(store.data).toBe(before);
  expect(rig.publishWidget).toHaveBeenCalledTimes(writes);
  expect(random).toHaveBeenCalledTimes(selections);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  expect(store.data).not.toBe(before);
  expect(store.data.cards).toBe(before.cards);
  expect(store.data.decks).toBe(before.decks);
  expect(rig.publishWidget.mock.calls.at(-1)?.[0]).toMatchObject({
    dueCount: 1,
    topCard: { id: card.id },
  });
  expect(mounts).toBe(1);
});

function Poller({ enabled, work }: { enabled: boolean; work: () => Promise<void> }) {
  const active = useAppActive();
  usePolling(enabled && active, work);
  return null;
}
it('starts generation polling when activation arrives between render and the effect subscription', async () => {
  rig.appState = 'inactive';
  const work = vi.fn(async () => {});
  function ActivatingScreen() {
    useLayoutEffect(() => {
      rig.appState = 'active';
    }, []);
    return React.createElement(Poller, { enabled: true, work });
  }
  await act(async () => {
    renderer = create(React.createElement(ActivatingScreen));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500);
  });
  expect(work).toHaveBeenCalledTimes(1);
});
it('generation polling continues after unchanged responses and pauses when hidden or backgrounded', async () => {
  const work = vi.fn(async () => {});
  await act(async () => {
    renderer = create(React.createElement(Poller, { enabled: true, work }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(7500);
  });
  expect(work).toHaveBeenCalledTimes(3);
  await act(async () => {
    renderer!.update(React.createElement(Poller, { enabled: false, work }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(7500);
  });
  expect(work).toHaveBeenCalledTimes(3);
  await act(async () => {
    emitState('background');
    renderer!.update(React.createElement(Poller, { enabled: true, work }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(7500);
  });
  expect(work).toHaveBeenCalledTimes(3);
  await act(async () => {
    emitState('active');
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500);
  });
  expect(work).toHaveBeenCalledTimes(4);
});

it('generation polling never overlaps a slow request or schedules another request after unmount', async () => {
  const held = deferred();
  const work = vi.fn(async () => {
    await held.promise;
  });
  await act(async () => {
    renderer = create(React.createElement(Poller, { enabled: true, work }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(work).toHaveBeenCalledTimes(1);
  await act(async () => {
    renderer!.update(React.createElement(Poller, { enabled: false, work }));
  });
  await act(async () => {
    renderer!.update(React.createElement(Poller, { enabled: true, work }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(work).toHaveBeenCalledTimes(1);
  await act(async () => {
    renderer!.unmount();
    renderer = null;
    held.resolve(null);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(work).toHaveBeenCalledTimes(1);
});
