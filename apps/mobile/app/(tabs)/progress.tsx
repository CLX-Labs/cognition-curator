import React, { useMemo, useState } from 'react';
import { router } from 'expo-router';
import type { InsightDays } from '@recollect/contracts';
import { useStore } from '../../src/store';
import { Button, Panel, Screen, Text, s } from '../../src/ui';
import { BrandPattern } from '../../src/brand-patterns';
import { InsightCards, InsightRange, InsightSummary } from '../../src/insight-panels';
import { personalInsights } from '../../src/personal-insights';

export default function Progress() {
  const { data } = useStore();
  const [days, setDays] = useState<InsightDays>(30);
  const insights = useMemo(() => personalInsights(data, days), [data, days]);
  return (
    <Screen
      title="Your progress"
      eyebrow="03 / LITTLE BY LITTLE"
      action={<BrandPattern variant="orbit" width={56} height={56} />}
      subtitle="A closer look at what is sticking."
    >
      <InsightRange days={days} onChange={setDays} />
      <InsightSummary insights={insights} />
      <Panel>
        <Text style={s.sectionTitle}>Learn alongside friends</Text>
        <Text style={s.body}>
          Share decks and follow each other’s card-by-card recall over time.
        </Text>
        <Button
          title="Friends & shared decks →"
          variant="secondary"
          onPress={() => router.push('/friends')}
        />
      </Panel>
      <InsightCards
        insights={insights}
        onSelect={(card) =>
          router.push({
            pathname: '/insights',
            params: { cardId: card.id, deckId: card.deckId, days: days ?? 'all' },
          })
        }
      />
      <Text style={s.caption}>
        Self-reported recall from recorded reviews, including practice. Older imported history may
        be incomplete. Your insights include reviews saved offline on this device.
      </Text>
    </Screen>
  );
}
