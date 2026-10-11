import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { Session } from '@recollect/contracts';
import { openDatabase } from './database';
import { Repository, dueCards, installationDeviceId, type LocalSnapshot } from './repository';
import { api } from './api';
import { SyncEngine } from './sync';
import { publishWidget, setWidgetOwner } from '../modules/recollect-widget';
import { WidgetCoordinator } from './widget-coordinator';

const widgets = new WidgetCoordinator({ publishWidget, setWidgetOwner });

const empty: LocalSnapshot = { decks: [], cards: [], reviews: [], pending: 0, issues: [] };
type AppStore = {
  session: Session | null;
  ready: boolean;
  repository: Repository | null;
  data: LocalSnapshot;
  syncState: 'idle' | 'syncing' | 'offline';
  syncError: string | null;
  initializationError: string | null;
  widgetError: string | null;
  refresh(): Promise<void>;
  sync(): Promise<void>;
  mutate(action: (repository: Repository) => Promise<unknown>): Promise<void>;
  signOut(): Promise<void>;
};
const Context = createContext<AppStore | null>(null);
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [repository, setRepository] = useState<Repository | null>(null);
  const [data, setData] = useState(empty);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<AppStore['syncState']>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const engine = useRef<SyncEngine | null>(null);
  const liveRepository = useRef<Repository | null>(null);
  const ownerEpoch = useRef(0);

  const refresh = useCallback(async () => {
    const current = liveRepository.current;
    if (!current) return;
    const next = await current.snapshot();
    if (liveRepository.current !== current) return;
    setData(next);
    const due = dueCards(next);
    const first = due[0];
    await widgets
      .publish({
        ownerId: current.ownerId,
        dueCount: due.length,
        hasCards: next.cards.length > 0,
        updatedAt: new Date().toISOString(),
        topCard: first
          ? {
              id: first.id,
              question: first.front,
              answer: first.back,
              deckName: next.decks.find((d) => d.id === first.deckId)?.name ?? 'Your cards',
            }
          : null,
      })
      .then(() => {
        if (liveRepository.current === current) setWidgetError(null);
      })
      .catch((error) => {
        if (liveRepository.current === current)
          setWidgetError(error instanceof Error ? error.message : 'The widget could not refresh.');
      });
  }, []);
  const sync = useCallback(async () => {
    const active = engine.current;
    if (!active) return;
    setSyncState('syncing');
    try {
      await active.run();
      if (engine.current !== active) return;
      setSyncState('idle');
      setSyncError(null);
      await refresh();
    } catch (error) {
      if (engine.current !== active) return;
      setSyncState('offline');
      setSyncError(
        error instanceof Error
          ? error.message
          : 'Connection interrupted. Your changes are saved on this device.',
      );
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    const unsubscribe = api.subscribe((next) => setSession(next));
    api
      .initialize()
      .then((next) => {
        setSession(next);
        setReady(true);
      })
      .catch((error) => {
        setInitializationError(
          error instanceof Error ? error.message : 'Secure storage could not be opened.',
        );
        setReady(true);
      });
    return unsubscribe;
  }, []);
  useEffect(() => {
    const epoch = ++ownerEpoch.current;
    engine.current?.stop();
    engine.current = null;
    liveRepository.current = null;
    setRepository(null);
    setData(empty);
    setSyncState('idle');
    setSyncError(null);
    const owner = session?.user.id;
    if (!owner) {
      void widgets
        .setOwner(null)
        .catch((error) =>
          setWidgetError(
            error instanceof Error ? error.message : 'The widget could not be cleared.',
          ),
        );
      return;
    }
    const setup = async () => {
      await widgets.setOwner(owner).catch((error) => {
        if (epoch === ownerEpoch.current)
          setWidgetError(error instanceof Error ? error.message : 'Widgets are unavailable.');
      });
      if (epoch !== ownerEpoch.current) return;
      const db = await openDatabase();
      const device = await installationDeviceId(db, Crypto.randomUUID);
      const repo = new Repository(db, owner, device, Crypto.randomUUID);
      await repo.initialize();
      if (epoch !== ownerEpoch.current) return;
      liveRepository.current = repo;
      engine.current = new SyncEngine(
        repo,
        { request: (path, options) => api.request(path, { ...options, ownerId: owner }) },
        () => {
          void refresh();
        },
      );
      await refresh();
      if (epoch !== ownerEpoch.current) return;
      // Screens, including cold widget links, mount only after local hydration.
      setRepository(repo);
      void sync();
    };
    void setup().catch((error) =>
      setInitializationError(
        error instanceof Error ? error.message : 'Local storage could not be opened.',
      ),
    );
    return () => {
      ++ownerEpoch.current;
      engine.current?.stop();
    };
  }, [session?.user.id, refresh, sync]);
  useEffect(() => {
    if (!repository) return;
    const timer = setInterval(() => {
      void sync();
    }, 15_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh();
        void sync();
      }
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [repository, refresh, sync]);
  const mutate = useCallback(
    async (action: (repo: Repository) => Promise<unknown>) => {
      const current = liveRepository.current;
      if (!current) throw new Error('Your local library is still opening.');
      await action(current);
      await refresh();
      void sync();
    },
    [refresh, sync],
  );
  const signOut = useCallback(async () => {
    ++ownerEpoch.current;
    engine.current?.stop();
    engine.current = null;
    liveRepository.current = null;
    setRepository(null);
    setData(empty);
    await widgets
      .setOwner(null)
      .catch((error) =>
        setWidgetError(error instanceof Error ? error.message : 'The widget could not be cleared.'),
      );
    await api.logout();
  }, []);
  const currentOwner = repository?.ownerId === session?.user.id;
  return (
    <Context.Provider
      value={{
        session,
        ready,
        repository: currentOwner ? repository : null,
        data: currentOwner ? data : empty,
        syncState,
        syncError,
        initializationError,
        widgetError,
        refresh,
        sync,
        mutate,
        signOut,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useStore() {
  const value = useContext(Context);
  if (!value) throw new Error('StoreProvider is missing.');
  return value;
}
