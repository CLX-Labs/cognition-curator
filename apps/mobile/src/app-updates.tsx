import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';
import { createUpdateChecker } from './release';
import { colors } from './ui';

type UpdateState = ReturnType<typeof Updates.useUpdates> & {
  enabled: boolean;
  pending: boolean;
  restarting: boolean;
  check(): Promise<'ready' | 'none' | 'unchanged'>;
  restart(): Promise<void>;
};
const Context = createContext<UpdateState | null>(null);

export function AppUpdateProvider({ children }: { children: React.ReactNode }) {
  const state = Updates.useUpdates();
  const enabled = Platform.OS !== 'web' && !__DEV__ && Updates.isEnabled;
  const checker = useMemo(() => createUpdateChecker(Updates), []);
  const [downloadReady, setDownloadReady] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const reloadInFlight = useRef(false);
  const pending = downloadReady || state.isUpdatePending;
  const current = useRef({ pending, checking: state.isChecking || state.isDownloading });
  current.current = { pending, checking: state.isChecking || state.isDownloading };

  useEffect(() => {
    if (!enabled) return;
    const check = () => {
      if (
        AppState.currentState !== 'active' ||
        current.current.pending ||
        current.current.checking
      )
        return;
      void checker
        .check()
        .then((result) => {
          if (result === 'ready') setDownloadReady(true);
        })
        .catch(() => {
          // Offline checks leave the running app available. Manual checks report errors.
        });
    };
    // Expo performs its own launch check; continue checking during longer sessions.
    const timer = setInterval(check, 60_000);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') check();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [checker, enabled]);

  async function check() {
    if (!enabled) throw new Error('OTA checks are available in installed release builds.');
    const result = await checker.check(true);
    if (result === 'ready') setDownloadReady(true);
    return result;
  }
  async function restart() {
    if (!enabled || !pending || reloadInFlight.current) return;
    reloadInFlight.current = true;
    setRestarting(true);
    try {
      await Updates.reloadAsync();
    } catch (error) {
      reloadInFlight.current = false;
      setRestarting(false);
      throw error;
    }
  }
  return (
    <Context.Provider value={{ ...state, enabled, pending, restarting, check, restart }}>
      {children}
    </Context.Provider>
  );
}

export function useAppUpdates() {
  const value = useContext(Context);
  if (!value) throw new Error('AppUpdateProvider is missing.');
  return value;
}

export function UpdateNotice() {
  const { enabled, pending, restarting, restart } = useAppUpdates();
  const insets = useSafeAreaInsets();
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!pending) {
      setDismissed(false);
      setError(null);
    }
  }, [pending]);
  if (!enabled || !pending || dismissed) return null;
  return (
    <View
      style={[styles.notice, { paddingBottom: Math.max(insets.bottom, 14) }]}
      accessibilityLiveRegion="polite"
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.title}>An update is ready</Text>
        <Text style={styles.detail}>
          {error ?? 'Save any edits, then restart to apply it.'}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Restart to apply update"
        accessibilityState={{ disabled: restarting }}
        disabled={restarting}
        style={styles.restart}
        onPress={() => {
          setError(null);
          void restart().catch(() =>
            setError('Close and reopen the app to apply the update.'),
          );
        }}
      >
        <Text style={styles.restartText}>{restarting ? 'Restarting…' : 'Restart'}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Apply update later"
        disabled={restarting}
        style={styles.later}
        onPress={() => setDismissed(true)}
      >
        <Text style={styles.laterText}>Later</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  notice: {
    backgroundColor: colors.green,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingHorizontal: 18,
    paddingTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  detail: { color: colors.ink, fontSize: 12, lineHeight: 17 },
  restart: {
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: colors.ink,
    borderRadius: 12,
  },
  restartText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  later: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  laterText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
});
