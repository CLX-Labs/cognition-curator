import React from 'react';
import { router } from 'expo-router';
import { useStore } from '../../src/store';
import { useCommunityResource } from '../../src/community-api';
import { marketplaceApi } from '../../src/marketplace-api';
import { MarketplaceFeedback, MarketplaceUsageConsent } from '../../src/marketplace-ui';
import { Back, Button, Empty, Panel, Screen, Text, s } from '../../src/ui';

export default function MarketplaceDownloads() {
  const { data } = useStore();
  const result = useCommunityResource('marketplace-downloads', marketplaceApi.downloads);
  async function contribution(listingId: string, enabled: boolean) {
    const changed = await result.run(listingId, (ownerId) =>
      marketplaceApi.usage(ownerId, listingId, enabled),
    );
    if (changed) await result.refresh();
  }
  return (
    <Screen
      title="Your downloads"
      eyebrow="MARKETPLACE / YOUR CHOICES"
      leading={<Back label="Marketplace" onPress={() => router.dismissTo('/marketplace')} />}
      subtitle="Your learning, your choice to share."
    >
      <Text style={s.body}>
        Manage aggregate practice contribution here, even if a publication is removed or you delete
        your local copy. Contribution starts off for every download.
      </Text>
      <MarketplaceFeedback
        loading={result.loading}
        error={result.error}
        retry={() => void result.refresh()}
      />
      {result.data?.downloads.map((copy) => {
        const deck = data.decks.find((item) => item.id === copy.deckId);
        return (
          <Panel key={copy.listingId}>
            <Text style={s.sectionTitle}>{deck?.name ?? 'Previously downloaded deck'}</Text>
            <Text style={s.caption}>
              Added version {copy.version}
              {!deck ? ' · Copy not on this device' : ''}
            </Text>
            <MarketplaceUsageConsent
              enabled={copy.contributeUsage}
              disabled={!!result.busy}
              onChange={(enabled) => void contribution(copy.listingId, enabled)}
            />
            {deck && (
              <Button
                title="Open your copy"
                size="compact"
                variant="secondary"
                onPress={() => router.push({ pathname: '/decks/[id]', params: { id: deck.id } })}
              />
            )}
          </Panel>
        );
      })}
      {result.data?.downloads.length === 0 && (
        <Empty
          title="A collection waiting to happen."
          detail="Explore the marketplace and add a deck to your library."
        />
      )}
    </Screen>
  );
}
