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
import {
  profileSchema,
  profileUpdateSchema,
  type Profile,
  type ProfileUpdate,
  type User,
} from '@recollect/contracts';
import { api } from './api';
import { useStore } from './store';
import type { Repository } from './repository';

type ProfileState = {
  profile: Profile;
  loading: boolean;
  error: string | null;
  refresh(force?: boolean): Promise<void>;
  save(patch: ProfileUpdate): Promise<void>;
};
const Context = createContext<ProfileState | null>(null);
const CACHE_KEY = 'accountProfile';

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { session, repository } = useStore();
  if (!session || !repository || repository.ownerId !== session.user.id) return <>{children}</>;
  return (
    <OwnerProfile key={session.user.id} user={session.user} repository={repository}>
      {children}
    </OwnerProfile>
  );
}

function OwnerProfile({
  user,
  repository,
  children,
}: {
  user: User;
  repository: Repository;
  children: React.ReactNode;
}) {
  const [saved, setSaved] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const generation = useRef(0);
  const fetchFlight = useRef<Promise<void> | null>(null);
  const saving = useRef(false);
  const lastFetch = useRef(0);
  const cacheTail = useRef(Promise.resolve());

  const accept = useCallback(
    (profile: Profile) => {
      if (profile.id !== repository.ownerId) throw new Error('The signed-in account changed.');
      setSaved((previous) =>
        previous?.name === profile.name && previous.photoDataUrl === profile.photoDataUrl
          ? previous
          : profile,
      );
      // Photos belong in owner-scoped SQLite, never in the size-limited keychain.
      cacheTail.current = cacheTail.current
        .then(() => repository.setState(CACHE_KEY, profile))
        .catch(() => {});
    },
    [repository],
  );

  const refresh = useCallback(
    (force = false): Promise<void> => {
      if (fetchFlight.current) return fetchFlight.current;
      if (saving.current || (!force && Date.now() - lastFetch.current < 60_000))
        return Promise.resolve();
      const current = ++generation.current;
      const promise = (async () => {
        try {
          const profile = profileSchema.parse(
            await api.request('/v1/profile', { ownerId: repository.ownerId }),
          );
          if (!active.current || current !== generation.current) return;
          accept(profile);
          lastFetch.current = Date.now();
          setError(null);
        } catch (cause) {
          if (active.current && current === generation.current)
            setError(cause instanceof Error ? cause.message : 'Your profile could not refresh.');
        } finally {
          if (active.current && current === generation.current) setLoading(false);
        }
      })().finally(() => {
        if (fetchFlight.current === promise) fetchFlight.current = null;
      });
      fetchFlight.current = promise;
      return promise;
    },
    [repository, accept],
  );

  const save = useCallback(
    async (input: ProfileUpdate) => {
      if (saving.current) throw new Error('Your profile is already saving.');
      const patch = profileUpdateSchema.parse(input);
      saving.current = true;
      const current = ++generation.current;
      try {
        const profile = profileSchema.parse(
          await api.request('/v1/profile', {
            method: 'PATCH',
            body: patch,
            ownerId: repository.ownerId,
          }),
        );
        if (!active.current || current !== generation.current)
          throw new Error('The signed-in account changed.');
        accept(profile);
        lastFetch.current = Date.now();
        setError(null);
        setLoading(false);
      } finally {
        saving.current = false;
      }
    },
    [repository, accept],
  );

  useEffect(() => {
    active.current = true;
    const before = generation.current;
    void (async () => {
      try {
        const cached = profileSchema.safeParse(await repository.getState(CACHE_KEY));
        if (
          active.current &&
          before === generation.current &&
          cached.success &&
          cached.data.id === repository.ownerId
        ) {
          setSaved(cached.data);
          setLoading(false);
        }
      } catch {
        /* A missing cache must not prevent an online profile refresh. */
      }
      if (active.current && before === generation.current) await refresh();
    })();
    let previous = AppState.currentState;
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active' && previous !== 'active') void refresh();
      previous = state;
    });
    return () => {
      active.current = false;
      ++generation.current;
      fetchFlight.current = null;
      listener.remove();
    };
  }, [repository, refresh]);

  const value = useMemo(
    () => ({
      profile: saved ?? { id: user.id, name: user.name, photoDataUrl: null },
      loading,
      error,
      refresh,
      save,
    }),
    [saved, user.id, user.name, loading, error, refresh, save],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useProfile() {
  const profile = useContext(Context);
  if (!profile) throw new Error('ProfileProvider is required.');
  return profile;
}
