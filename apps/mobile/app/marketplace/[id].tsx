import React from 'react';
import { Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useStore } from '../../src/store';
import { useCommunityResource } from '../../src/community-api';
import { downloadMarketplaceDeck, marketplaceApi } from '../../src/marketplace-api';
import {
  MarketplaceFeedback,
  MarketplaceMetrics,
  MarketplaceSafety,
  MarketplaceToggle,
  MarketplaceUsageConsent,
} from '../../src/marketplace-ui';
import { DeckArtwork } from '../../src/brand-patterns';
import { Back, Button, Panel, Screen, Text, s } from '../../src/ui';

export default function MarketplaceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MarketplaceDetailForAccount key={id} id={id} />;
}
function MarketplaceDetailForAccount({ id }: { id: string }) {
  const { data, repository, sync, refresh } = useStore();
  const result = useCommunityResource('marketplace-detail:' + id, (ownerId) =>
    marketplaceApi.detail(ownerId, id),
  );
  const listing = result.data?.listing;
  const owned = listing?.publisher.id === result.ownerId;
  const original =
    listing?.sourceDeckId && data.decks.find((deck) => deck.id === listing.sourceDeckId);
  const localCopy =
    listing?.download && data.decks.find((deck) => deck.id === listing.download!.deckId);
  async function download() {
    if (!repository) return;
    const receipt = await result.run('download', (ownerId) =>
      downloadMarketplaceDeck(repository, ownerId, id, sync, refresh),
    );
    if (receipt) router.push({ pathname: '/decks/[id]', params: { id: receipt.deckId } });
  }
  async function toggleUsage(enabled: boolean) {
    const changed = await result.run('usage', (ownerId) =>
      marketplaceApi.usage(ownerId, id, enabled),
    );
    if (changed) await result.refresh();
  }
  async function settings(change: {
    isPublished?: boolean;
    showDownloadCount?: boolean;
    showUsageStats?: boolean;
  }) {
    const changed = await result.run('settings', (ownerId) =>
      marketplaceApi.settings(ownerId, id, change),
    );
    if (changed) await result.refresh();
  }
  function visibility(enabled: boolean) {
    if (enabled) {
      void settings({ isPublished: true });
      return;
    }
    Alert.alert(
      'Unpublish this deck?',
      'It will disappear from the marketplace. Existing downloaded copies stay in people’s libraries. You can restore this published snapshot later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpublish',
          style: 'destructive',
          onPress: () => void settings({ isPublished: false }),
        },
      ],
    );
  }
  return (
    <Screen
      title={listing?.deck.name ?? 'Deck preview'}
      eyebrow="MARKETPLACE"
      leading={<Back label="Marketplace" onPress={() => router.dismissTo('/marketplace')} />}
      action={
        listing ? (
          <DeckArtwork
            id={id}
            color={listing.deck.color}
            icon={listing.deck.icon}
            imageDataUrl={listing.deck.imageDataUrl}
            size={60}
          />
        ) : undefined
      }
      subtitle={
        listing
          ? 'By ' +
            listing.publisher.name +
            ' · ' +
            listing.cardCount +
            ' cards · Version ' +
            listing.version
          : undefined
      }
    >
      <MarketplaceFeedback
        loading={result.loading}
        error={result.error}
        retry={() => void result.refresh()}
      />
      {!!listing && (
        <>
          {!!listing.deck.description && <Text style={s.body}>{listing.deck.description}</Text>}
          <MarketplaceMetrics listing={listing} />
          <Panel tint>
            <Text style={s.sectionTitle}>
              {owned ? 'Your published snapshot.' : 'A copy to make your own.'}
            </Text>
            <Text style={s.body}>
              {owned
                ? 'This public snapshot stays available until you unpublish it, even if you edit or delete the original deck. Your private review history stays private.'
                : 'Downloading adds an independent copy to your library. Your edits and practice schedule stay yours. Later publisher changes do not update your copy.'}
            </Text>
            {owned ? (
              <>
                <MarketplaceToggle
                  title="Published in marketplace"
                  detail="Turn this off to remove the listing. Turning it on restores this saved snapshot; existing downloaded copies remain independent."
                  value={listing.isPublished}
                  disabled={!!result.busy}
                  onChange={visibility}
                />
                <MarketplaceToggle
                  title="Show download count"
                  detail="You can show or hide this unique download count at any time."
                  value={listing.showDownloadCount}
                  disabled={!!result.busy}
                  onChange={(enabled) => void settings({ showDownloadCount: enabled })}
                />
                <MarketplaceToggle
                  title="Show aggregate practice activity"
                  detail="Only broad trends from at least 5 eligible consenting learners over the last 30 days can appear. Individual progress stays private."
                  value={listing.showUsageStats}
                  disabled={!!result.busy}
                  onChange={(enabled) => void settings({ showUsageStats: enabled })}
                />
                {original ? (
                  <Button
                    title="Open original to update published copy"
                    size="compact"
                    variant="secondary"
                    onPress={() =>
                      router.push({ pathname: '/decks/[id]', params: { id: original.id } })
                    }
                  />
                ) : (
                  <Text style={s.caption}>
                    Your original deck is not on this device. You can still control this publication
                    here.
                  </Text>
                )}
              </>
            ) : localCopy ? (
              <>
                <Text style={s.caption}>
                  Added version {listing.download!.version}
                  {listing.download!.version < listing.version
                    ? ' · This publication has newer cards; your copy stays unchanged.'
                    : ''}
                </Text>
                <Button
                  title="Open your copy"
                  size="compact"
                  onPress={() =>
                    router.push({ pathname: '/decks/[id]', params: { id: localCopy.id } })
                  }
                />
              </>
            ) : (
              <Button
                title={listing.download ? 'Sync downloaded copy' : 'Download deck'}
                size="compact"
                disabled={!!result.busy}
                loading={result.busy === 'download'}
                onPress={() => void download()}
              />
            )}
            {!!listing.download && (
              <MarketplaceUsageConsent
                enabled={listing.download.contributeUsage}
                disabled={!!result.busy}
                onChange={(enabled) => void toggleUsage(enabled)}
              />
            )}
            {!listing.download && !owned && (
              <Text style={s.caption}>
                Practice contribution starts off. You can choose to share aggregate activity after
                downloading.
              </Text>
            )}
          </Panel>
          <Text style={s.eyebrow}>A FEW CARDS INSIDE</Text>
          {result.data?.cards.map((card, index) => (
            <Panel key={index} style={{ padding: 20 }}>
              <Text style={s.label}>{card.front}</Text>
              <Text style={s.body}>{card.back}</Text>
              {!!card.hint && <Text style={s.caption}>Hint: {card.hint}</Text>}
              {card.aiGenerated && (
                <Text style={s.caption}>AI assisted · check important details</Text>
              )}
            </Panel>
          ))}
          {!owned && <MarketplaceSafety key={listing.id} listing={listing} />}
        </>
      )}
    </Screen>
  );
}
