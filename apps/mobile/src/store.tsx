import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { Session } from '@recollect/contracts';
import { openDatabase } from './database';
import {
  Repository,
  dueCards,
  eraseOwnerData,
  installationDeviceId,
  type LocalSnapshot,
} from './repository';
import { api, type AccountDeletionRecovery } from './api';
import { SyncEngine } from './sync';
import { publishWidget, setWidgetOwner } from '../modules/recollect-widget';
import { WidgetCoordinator } from './widget-coordinator';
import { createRefreshQueue, shareSnapshot } from './store-refresh';

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
  sync(options?: { silent?: boolean }): Promise<void>;
  mutate(action: (repository: Repository) => Promise<unknown>): Promise<void>;
  signOut(): Promise<void>;
  deletionRecovery: AccountDeletionRecovery | null;
  deletionBusy: boolean;
  deletionError: string | null;
  requestAccountDeletion(ownerId: string): Promise<void>;
  retryAccountDeletion(): Promise<void>;
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
  const [deletionRecovery, setDeletionRecovery] = useState<AccountDeletionRecovery | null>(null);
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [deletionError, setDeletionError] = useState<string | null>(null);
  const deleting = useRef(false);
  const engine = useRef<SyncEngine | null>(null);
  const liveRepository = useRef<Repository | null>(null);
  const ownerEpoch = useRef(0);
  const syncFlight = useRef<{ engine: SyncEngine; promise: Promise<void> } | null>(null);
  const snapshot = useRef<{
    repository: Repository;
    data: LocalSnapshot;
    dueIds: string;
  } | null>(null);

  const readSnapshot = useCallback(async () => {
    const current = liveRepository.current;
    if (!current) return;
    const next = await current.snapshot();
    if (liveRepository.current !== current) return;
    const due = dueCards(next);
    const dueIds = due.map((card) => card.id).join(',');
    const previous = snapshot.current?.repository === current ? snapshot.current : null;
    let shared = previous ? shareSnapshot(previous.data, next) : next;
    // Due cards can change with the clock even when SQLite content is unchanged.
    if (previous && shared === previous.data && previous.dueIds !== dueIds) shared = { ...shared };
    snapshot.current = { repository: current, data: shared, dueIds };
    setData(shared);
    const first = due[0];
    // Native widget work must not block hydration, editing, or synchronization.
    void widgets
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
  const refresh = useMemo(() => createRefreshQueue(readSnapshot), [readSnapshot]);
  const sync = useCallback(
    (options: { silent?: boolean } = {}) => {
      const deletion = api.deletionRecovery();
      if (deletion && !deletion.localCleared) return Promise.resolve();
      const active = engine.current;
      if (!active) return Promise.resolve();
      if (!options.silent) setSyncState('syncing');
      if (syncFlight.current?.engine === active) return syncFlight.current.promise;
      const task: Promise<void> = (async () => {
        try {
          await active.run();
          if (engine.current !== active) return;
          await refresh();
          if (engine.current !== active) return;
          setSyncState('idle');
          setSyncError(null);
        } catch (error) {
          if (engine.current !== active) return;
          setSyncState('offline');
          setSyncError(
            error instanceof Error
              ? error.message
              : 'Connection interrupted. Your changes are saved on this device.',
          );
          await refresh().catch(() => undefined);
        }
      })().finally(() => {
        if (syncFlight.current?.promise === task) syncFlight.current = null;
      });
      syncFlight.current = { engine: active, promise: task };
      return task;
    },
    [refresh],
  );

  const finishLocalDeletion = useCallback(async (record: AccountDeletionRecovery) => {
    if (!record.receipt || record.receipt.ownerId !== record.ownerId)
      throw new Error('Confirm the deletion request before removing local data.');
    await api.assertDeletionOwner(record.ownerId);
    if (api.session && api.session.user.id !== record.ownerId)
      throw new Error('Another account is signed in. Its data has not been changed.');
    const current = liveRepository.current;
    if (current && current.ownerId !== record.ownerId)
      throw new Error('The active local library belongs to another account.');
    ++ownerEpoch.current;
    engine.current?.stop();
    engine.current = null;
    current?.retire();
    liveRepository.current = null;
    snapshot.current = null;
    setRepository(null);
    setData(empty);
    await syncFlight.current?.promise.catch(() => undefined);
    await current?.retireAndDrain();
    await api.assertDeletionOwner(record.ownerId);
    await widgets.clearOwner(record.ownerId);
    const db = await openDatabase();
    await installationDeviceId(db, Crypto.randomUUID);
    await eraseOwnerData(db, record.ownerId);
    await api.forgetDeletedAccount(record.ownerId);
    await api.finishDeletionRecovery(record.ownerId);
    setDeletionRecovery(api.deletionRecovery(record.ownerId));
    setSession(api.session);
    setSyncError(null);
    setWidgetError(null);
    setDeletionError(null);
  }, []);
  const requestAccountDeletion = useCallback(
    async (ownerId: string) => {
      if (deleting.current) return;
      if (api.session && api.session.user.id !== ownerId)
        throw new Error('The signed-in account changed.');
      deleting.current = true;
      setDeletionBusy(true);
      setDeletionError(null);
      const previous = api.deletionRecovery(ownerId);
      try {
        await api.requestAccountDeletion(
          ownerId,
          previous?.operationId ?? Crypto.randomUUID(),
          (record) => {
            setDeletionRecovery(record);
          },
        );
        const record = api.deletionRecovery(ownerId);
        if (!record?.receipt)
          throw new Error('The deletion receipt could not be saved. Retry with Apple.');
        setDeletionRecovery(record);
        await finishLocalDeletion(record);
      } catch (cause) {
        setDeletionRecovery(api.deletionRecovery());
        const message =
          cause instanceof Error
            ? cause.message
            : 'The deletion request could not be confirmed. Try again.';
        setDeletionError(message);
        throw cause;
      } finally {
        deleting.current = false;
        setDeletionBusy(false);
      }
    },
    [finishLocalDeletion],
  );
  const retryAccountDeletion = useCallback(async () => {
    const record = api.deletionRecovery();
    if (!record || deleting.current) return;
    if (record.receipt && !record.localCleared) {
      deleting.current = true;
      setDeletionBusy(true);
      setDeletionError(null);
      try {
        await finishLocalDeletion(record);
      } catch (cause) {
        setDeletionError(
          cause instanceof Error ? cause.message : 'Local cleanup did not finish. Try again.',
        );
      } finally {
        deleting.current = false;
        setDeletionBusy(false);
      }
    } else await requestAccountDeletion(record.ownerId).catch(() => undefined);
  }, [finishLocalDeletion, requestAccountDeletion]);

  useEffect(() => {
    let active = true;
    const unsubscribe = api.subscribe((next) => {
      if (active) setSession(next);
    });
    api
      .initialize()
      .then(async (next) => {
        if (!active) return;
        const recovery = api.deletionRecovery();
        setDeletionRecovery(recovery);
        if (recovery?.receipt && !recovery.localCleared) {
          setDeletionBusy(true);
          try {
            await finishLocalDeletion(recovery);
          } catch (cause) {
            setDeletionError(
              cause instanceof Error ? cause.message : 'Local deletion cleanup did not finish.',
            );
          } finally {
            setDeletionBusy(false);
          }
        }
        setSession(next);
        setReady(true);
      })
      .catch((error) => {
        if (!active) return;
        setInitializationError(
          error instanceof Error ? error.message : 'Secure storage could not be opened.',
        );
        setReady(true);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [finishLocalDeletion]);
  useEffect(() => {
    const epoch = ++ownerEpoch.current;
    engine.current?.stop();
    engine.current = null;
    liveRepository.current = null;
    snapshot.current = null;
    setRepository(null);
    setData(empty);
    setSyncState('idle');
    setSyncError(null);
    setInitializationError(null);
    const owner = session?.user.id;
    if (!owner) {
      void widgets.setOwner(null).catch((error) => {
        if (epoch === ownerEpoch.current)
          setWidgetError(
            error instanceof Error ? error.message : 'The widget could not be cleared.',
          );
      });
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
          void refresh().catch((error) => {
            if (epoch === ownerEpoch.current)
              setSyncError(
                error instanceof Error ? error.message : 'Local storage could not refresh.',
              );
          });
        },
      );
      await refresh();
      if (epoch !== ownerEpoch.current) return;
      // Screens, including cold widget links, mount only after local hydration.
      setRepository(repo);
      void sync({ silent: true });
    };
    void setup().catch((error) => {
      if (epoch !== ownerEpoch.current) return;
      setInitializationError(
        error instanceof Error ? error.message : 'Local storage could not be opened.',
      );
    });
    return () => {
      ++ownerEpoch.current;
      engine.current?.stop();
    };
  }, [session?.user.id, refresh, sync]);
  useEffect(() => {
    if (!repository) return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void sync({ silent: true });
    }, 15_000);
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (state) => {
      const resumed = state === 'active' && previousState !== 'active';
      previousState = state;
      if (resumed) void sync({ silent: true });
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [repository, refresh, sync]);
  const mutate = useCallback(
    async (action: (repo: Repository) => Promise<unknown>) => {
      const deletion = api.deletionRecovery();
      if (deletion && !deletion.localCleared)
        throw new Error(
          'Finish checking the account deletion request before changing this library.',
        );
      const current = liveRepository.current;
      if (!current) throw new Error('Your local library is still opening.');
      await action(current);
      await refresh();
      void sync({ silent: true });
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
        deletionRecovery,
        deletionBusy,
        deletionError,
        requestAccountDeletion,
        retryAccountDeletion,
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
