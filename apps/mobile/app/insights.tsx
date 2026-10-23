import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { recallInsightsSchema, type InsightDays, type RecallInsights } from '@recollect/contracts';
import { useStore } from '../src/store';
import { api } from '../src/api';
import { Back, Button, Empty, Panel, Screen, Text, colors, s } from '../src/ui';
import { BrandPattern } from '../src/brand-patterns';
import {
  InsightCardHistory,
  InsightCards,
  InsightRange,
  InsightSummary,
} from '../src/insight-panels';
import { personalInsights } from '../src/personal-insights';

export default function InsightsScreen() {
  const params = useLocalSearchParams<{
    deckId?: string;
    cardId?: string;
    shareId?: string;
    userId?: string;
    friendId?: string;
    name?: string;
    days?: string;
  }>();
  const { data, session } = useStore();
  const [days, setDays] = useState<InsightDays>(() =>
    params.days === 'all' ? null : params.days === '7' ? 7 : params.days === '90' ? 90 : 30,
  );
  const [selected, setSelected] = useState<string | null>(params.cardId ?? null);
  const [remote, setRemote] = useState<{ key: string; value: RecallInsights } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const sequence = useRef(0);
  const owner = session?.user.id;
  const shared = Boolean(params.shareId || params.friendId);
  const requestKey = [
    owner,
    params.friendId,
    params.shareId,
    params.userId,
    days ?? 'all',
    refresh,
  ].join('|');
  const error = failure?.key === requestKey ? failure.message : null;
  const loading = shared && !error && remote?.key !== requestKey;
  const own = useMemo(
    () => (shared ? null : personalInsights(data, days, params.deckId)),
    [data, days, params.deckId, shared],
  );
  useFocusEffect(
    useCallback(() => {
      if (!shared || !owner) return;
      let active = true;
      const current = ++sequence.current;
      setFailure(null);
      setRemote(null);
      const query = `days=${days ?? 'all'}&timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}`;
      const path = params.friendId
        ? `/v1/community/friends/${encodeURIComponent(params.friendId)}/insights?${query}`
        : `/v1/community/shares/${encodeURIComponent(params.shareId ?? '')}/insights/${encodeURIComponent(params.userId ?? '')}?${query}`;
      void api
        .request(path, { ownerId: owner })
        .then((value) => {
          const insights = recallInsightsSchema.parse(value);
          if (active && sequence.current === current)
            setRemote({ key: requestKey, value: insights });
        })
        .catch((cause) => {
          if (active && sequence.current === current)
            setFailure({
              key: requestKey,
              message: cause instanceof Error ? cause.message : 'These insights could not load.',
            });
        });
      return () => {
        active = false;
        sequence.current++;
        setRemote(null);
      };
    }, [shared, owner, params.friendId, params.shareId, params.userId, days, refresh, requestKey]),
  );
  const insights = shared ? (remote?.key === requestKey ? remote.value : null) : own;
  const card = insights?.cards.find((item) => item.id === selected);
  const deck = data.decks.find((item) => item.id === params.deckId);
  return (
    <Screen
      title={
        card
          ? 'A closer look'
          : shared
            ? params.userId === owner
              ? 'Your recall'
              : `${params.name?.slice(0, 100) || 'Your friend'}’s recall`
            : deck
              ? deck.name
              : 'Your insights'
      }
      eyebrow={shared ? 'LEARNING TOGETHER' : 'LITTLE BY LITTLE'}
      subtitle={
        shared
          ? 'Card-level recall from shared decks, with permission.'
          : 'Find what is sticking and what needs another look.'
      }
      leading={
        <Back
          label={selected ? 'All cards' : 'Back'}
          onPress={selected ? () => setSelected(null) : () => router.back()}
        />
      }
      action={<BrandPattern variant="orbit" width={56} height={56} />}
    >
      <InsightRange days={days} onChange={setDays} />
      {loading && (
        <Panel>
          <ActivityIndicator color={colors.accent} />
          <Text style={s.body}>Loading shared recall…</Text>
        </Panel>
      )}
      {error && (
        <Panel>
          <Text accessibilityRole="alert" style={[s.body, { color: colors.danger }]}>
            {error}
          </Text>
          <Text style={s.caption}>
            Only accepted shared decks with detailed-progress permission can appear here.
          </Text>
          <Button
            title="Try again"
            variant="secondary"
            onPress={() => setRefresh((value) => value + 1)}
          />
        </Panel>
      )}
      {insights &&
        (card ? (
          <>
            <InsightCardHistory card={card} />
            {!shared && (
              <Button
                title="Practice this card"
                onPress={() =>
                  router.push({
                    pathname: '/review',
                    params: { cardId: card.id, practice: 'true' },
                  })
                }
              />
            )}
          </>
        ) : selected ? (
          <Empty
            title="This card is unavailable"
            detail="It may have changed since sharing, been removed, or no longer be shared."
            action={<Button title="View all available cards" onPress={() => setSelected(null)} />}
          />
        ) : (
          <>
            <InsightSummary insights={insights} />
            <InsightCards insights={insights} onSelect={(item) => setSelected(item.id)} />
          </>
        ))}
      <Text style={s.caption}>
        These are self-reported responses, not graded answers. Based on recorded reviews; older
        imported history may be incomplete. Practice and scheduled reviews are included.
      </Text>
      {shared && !loading && !error && (
        <Button
          title="Refresh shared insights"
          variant="ghost"
          onPress={() => setRefresh((value) => value + 1)}
        />
      )}
    </Screen>
  );
}
