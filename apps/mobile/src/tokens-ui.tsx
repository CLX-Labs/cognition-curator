import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import type { TokenWallet } from '@recollect/contracts';
import { useStore } from './store';
import { useAppActive } from './polling';
import { fetchTokenWallet, onTokenWalletChanged } from './tokens';
import { Button, Panel, s, Text } from './ui';

export function useTokenWallet(refreshKey?: string | number | boolean) {
  const { repository } = useStore();
  const owner = repository?.ownerId;
  const focused = useIsFocused();
  const active = useAppActive();
  const [snapshot, setSnapshot] = useState<{ owner: string; wallet: TokenWallet } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const epoch = useRef(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(
    () =>
      onTokenWalletChanged((changedOwner) => {
        if (changedOwner === owner) refresh();
      }),
    [owner, refresh],
  );
  useEffect(() => {
    const current = ++epoch.current;
    setError(null);
    if (!owner || !focused || !active) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void fetchTokenWallet(owner)
      .then((wallet) => {
        if (epoch.current === current) setSnapshot({ owner, wallet });
      })
      .catch((cause) => {
        if (epoch.current === current)
          setError(cause instanceof Error ? cause.message : 'Connect to check your tokens.');
      })
      .finally(() => {
        if (epoch.current === current) setLoading(false);
      });
    return () => {
      ++epoch.current;
    };
  }, [owner, focused, active, refreshKey, revision]);
  return {
    wallet: snapshot && snapshot.owner === owner ? snapshot.wallet : null,
    error,
    loading,
    refresh,
  };
}

export function GenerationTokenNotice({ refreshKey }: { refreshKey?: string | number | boolean }) {
  const { wallet } = useTokenWallet(refreshKey);
  if (!wallet?.enabled) return null;
  return (
    <Panel tint style={{ padding: 14 }}>
      <Text style={s.label}>
        {wallet.available} {wallet.available === 1 ? 'token' : 'tokens'} available
      </Text>
      <Text style={s.caption}>
        One token when you accept a generation. A set of cards counts as one generation. Failed or
        dismissed suggestions are free.
      </Text>
      <Button
        title="Your tokens"
        variant="ghost"
        size="compact"
        onPress={() => router.push('/tokens')}
      />
    </Panel>
  );
}

export default function TokenBalancePanel() {
  const { wallet, error, loading, refresh } = useTokenWallet();
  return (
    <Panel tint>
      <Text style={s.eyebrow}>A LITTLE CURIOSITY GOES A LONG WAY</Text>
      <View style={s.between}>
        <Text style={s.sectionTitle}>Your tokens</Text>
        <Text style={[s.sectionTitle, { fontSize: 32 }]}>{wallet ? wallet.available : '—'}</Text>
      </View>
      <Text style={s.body}>
        {wallet?.enabled
          ? 'Spend one when you keep an AI generation. Make your own cards and practice for free.'
          : 'Ten free tokens a month. One accepted AI generation uses one token.'}
      </Text>
      {wallet && !wallet.enabled && <Text style={s.caption}>Token charging has not started.</Text>}
      {error && <Text style={s.caption}>Connect to see your current balance.</Text>}
      <Button
        title="Manage tokens"
        variant="secondary"
        size="compact"
        onPress={() => router.push('/tokens')}
      />
      {error && (
        <Button
          title="Check balance"
          variant="ghost"
          size="compact"
          loading={loading}
          onPress={refresh}
        />
      )}
    </Panel>
  );
}
