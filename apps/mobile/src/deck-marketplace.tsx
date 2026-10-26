import React, { useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useStore } from './store';
import { useProfile } from './profile';
import { useCommunityResource } from './community-api';
import {
  marketplaceApi,
  pendingMarketplacePublication,
  publishMarketplaceDeck,
  reviewedMarketplaceSnapshot,
  type PublicationIntent,
} from './marketplace-api';
import { ApiError } from './api';
import {
  MarketplaceFeedback,
  MarketplaceGuidelines,
  MarketplaceMetrics,
  MarketplaceToggle,
  MarketplaceUsageConsent,
} from './marketplace-ui';
import { Button, Panel, Text, colors, s } from './ui';
import { type SharedDeckSummary } from '@recollect/contracts';
import { DeckArtwork } from './brand-patterns';

export default function DeckMarketplace({ deckId }: { deckId: string }) {
  const { data, repository, sync } = useStore();
  const { profile } = useProfile();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [reviewed, setReviewed] = useState<ReturnType<typeof reviewedMarketplaceSnapshot> | null>(
    null,
  );
  const [pendingPublication, setPendingPublication] = useState<PublicationIntent | null>(null);
  const [publicationError, setPublicationError] = useState<string | null>(null);
  const [rights, setRights] = useState(false);
  const [downloadCount, setDownloadCount] = useState(false);
  const [usageStats, setUsageStats] = useState(false);
  const result = useCommunityResource(
    'deck-marketplace:' + deckId,
    async (ownerId) => {
      const [mine, copies] = await Promise.all([
        marketplaceApi.mine(ownerId),
        marketplaceApi.downloads(ownerId),
      ]);
      return {
        listing: mine.listings.find((item) => item.sourceDeckId === deckId) ?? null,
        download: copies.downloads.find((item) => item.deckId === deckId) ?? null,
      };
    },
    open,
  );
  const cardCount = data.cards.filter((card) => card.deckId === deckId).length;
  const currentReview = useMemo(() => {
    try {
      return reviewedMarketplaceSnapshot(data, deckId);
    } catch {
      return null;
    }
  }, [data.decks, data.cards, deckId]);
  const reviewChanged = confirm && !pendingPublication && reviewed?.json !== currentReview?.json;
  const listing = result.data?.listing;
  const reviewedDeck = useMemo(
    () => (reviewed ? (JSON.parse(reviewed.json) as { deck: SharedDeckSummary }).deck : null),
    [reviewed],
  );
  const copy = result.data?.download;
  async function publish() {
    if (!repository || !rights || !reviewed || reviewChanged) return;
    setPublicationError(null);
    const outcome = await result.run('publish', async (ownerId) => {
      try {
        const publication = await publishMarketplaceDeck(
          repository,
          ownerId,
          deckId,
          {
            showDownloadCount: listing?.showDownloadCount ?? downloadCount,
            showUsageStats: listing?.showUsageStats ?? usageStats,
          },
          () => sync({ throwOnError: true }),
          reviewed.json,
        );
        return { type: 'completed' as const, listing: publication };
      } catch (cause) {
        const saved = await pendingMarketplacePublication(repository, deckId).catch(() => null);
        return {
          type: 'failed' as const,
          saved,
          changed: cause instanceof ApiError && cause.code === 'publication_changed',
          message: cause instanceof Error ? cause.message : 'Could not publish. Try again.',
        };
      }
    });
    if (!outcome) return;
    if (outcome.type === 'failed') {
      setPendingPublication(outcome.saved?.attempted ? outcome.saved : null);
      if (outcome.changed) setRights(false);
      setPublicationError(outcome.message);
    } else {
      setConfirm(false);
      setRights(false);
      setPendingPublication(null);
      await result.refresh();
    }
  }
  async function beginPublication() {
    if (!currentReview || !repository) return;
    const preparation = await result.run('prepare', async (ownerId) => {
      if (repository.ownerId !== ownerId) throw new Error('The signed-in account changed.');
      return { saved: await pendingMarketplacePublication(repository, deckId) };
    });
    if (!preparation) return;
    setPendingPublication(preparation.saved?.attempted ? preparation.saved : null);
    setReviewed(currentReview);
    setConfirm(true);
    setRights(false);
    setPublicationError(null);
  }
  async function settings(change: {
    isPublished?: boolean;
    showDownloadCount?: boolean;
    showUsageStats?: boolean;
  }) {
    if (!listing) return;
    const changed = await result.run('settings', (ownerId) =>
      marketplaceApi.settings(ownerId, listing.id, change),
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
      'It will disappear from the marketplace. Existing downloaded copies stay in people’s libraries. You can publish this same snapshot again at any time.',
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
  async function contribution(enabled: boolean) {
    if (!copy) return;
    const changed = await result.run('usage', (ownerId) =>
      marketplaceApi.usage(ownerId, copy.listingId, enabled),
    );
    if (changed) await result.refresh();
  }
  return (
    <Panel style={{ padding: 18 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Marketplace settings for this deck"
        onPress={() => setOpen((value) => !value)}
        style={[s.between, { minHeight: 44 }]}
      >
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.sectionTitle}>Marketplace</Text>
          <Text style={s.caption}>Share an idea beyond your circle.</Text>
        </View>
        <Text style={{ color: colors.accent, fontSize: 22 }}>{open ? '−' : '+'}</Text>
      </Pressable>
      {open && (
        <>
          <MarketplaceFeedback
            loading={result.loading}
            error={publicationError ?? result.error}
            retry={() => {
              setPublicationError(null);
              void result.refresh();
            }}
          />
          {!!copy && (
            <>
              <Text style={s.eyebrow}>DOWNLOADED COPY / VERSION {copy.version}</Text>
              <Text style={s.caption}>
                This is your independent copy. Later publisher changes do not replace your cards.
              </Text>
              <MarketplaceUsageConsent
                enabled={copy.contributeUsage}
                disabled={!!result.busy}
                onChange={(enabled) => void contribution(enabled)}
              />
              <Button
                title="View original publication"
                size="compact"
                variant="ghost"
                onPress={() =>
                  router.push({ pathname: '/marketplace/[id]', params: { id: copy.listingId } })
                }
              />
              <View style={s.divider} />
            </>
          )}
          {!!listing && !confirm && (
            <>
              <Text style={s.caption}>
                Published snapshot · Version {listing.version} · {listing.cardCount} cards
              </Text>
              <Text style={s.body}>
                Edits in this deck do not update your publication. Use “Update published copy” to
                share them. This saved public snapshot stays published until you unpublish it, even
                if you delete your original deck.
              </Text>
              <MarketplaceToggle
                title="Published in marketplace"
                detail="Turn this off to remove the listing. Existing downloads remain independent copies. Turning it on restores the last published snapshot."
                value={listing.isPublished}
                disabled={!!result.busy}
                onChange={visibility}
              />
              <MarketplaceToggle
                title="Show download count"
                detail="Show how many active accounts have downloaded this deck. Each account counts once. Hiding this count does not delete download records."
                value={listing.showDownloadCount}
                disabled={!!result.busy}
                onChange={(enabled) => void settings({ showDownloadCount: enabled })}
              />
              <MarketplaceToggle
                title="Show practice trends"
                detail="Show broad trends from consenting learners over the last 30 days, once at least 5 qualify. These trends do not show individual progress. Hiding them does not stop contributions or delete anyone’s reviews."
                value={listing.showUsageStats}
                disabled={!!result.busy}
                onChange={(enabled) => void settings({ showUsageStats: enabled })}
              />
              <MarketplaceMetrics listing={listing} />
              {listing.showUsageStats && listing.usageStats === null && (
                <Text style={s.caption}>
                  Practice trends are not available yet. At least 5 eligible contributing learners
                  are required.
                </Text>
              )}
              <Button
                title="Update published copy"
                size="compact"
                variant="secondary"
                disabled={!!result.busy || !cardCount}
                onPress={() => {
                  beginPublication();
                }}
              />
              <Button
                title="Preview publication"
                size="compact"
                variant="ghost"
                onPress={() =>
                  router.push({ pathname: '/marketplace/[id]', params: { id: listing.id } })
                }
              />
            </>
          )}
          {!!result.data && !listing && !confirm && (
            <>
              <Text style={s.body}>
                Publish a snapshot of this deck so other people can download their own copy. Your
                private edits, deck image changes and review history are never published
                automatically.
              </Text>
              <Button
                title="Publish this deck…"
                size="compact"
                variant="secondary"
                disabled={!cardCount || !!result.busy}
                onPress={() => {
                  beginPublication();
                }}
              />
              {!cardCount && (
                <Text style={s.caption}>Add at least one card before publishing.</Text>
              )}
            </>
          )}
          {confirm && (
            <>
              <Text style={s.sectionTitle}>
                {listing ? 'Update your public copy?' : 'Share beyond your circle?'}
              </Text>
              <Text style={s.body}>
                {pendingPublication?.reviewedName ?? reviewed?.name} ·{' '}
                {pendingPublication?.reviewedCardCount ?? reviewed?.cardCount} cards · Published as{' '}
                {profile.name}
              </Text>
              {!!reviewedDeck && !pendingPublication && (
                <View style={[s.row, { alignItems: 'center', gap: 16 }]}>
                  <DeckArtwork
                    id={reviewedDeck.id}
                    color={reviewedDeck.color}
                    icon={reviewedDeck.icon}
                    imageDataUrl={reviewedDeck.imageDataUrl}
                    size={96}
                  />
                  <View style={{ flex: 1, gap: 5 }}>
                    <Text style={s.label}>Cover in this snapshot</Text>
                    <Text style={s.caption}>
                      This image becomes visible in the marketplace and is included in new
                      downloaded copies.
                    </Text>
                  </View>
                </View>
              )}
              <Text style={s.body}>
                Your display name, deck name, description, deck image, and every card’s question,
                answer, hint, explanation, and tags will be visible to all signed-in users. Review
                them for personal information and accuracy. Downloads become independent copies that
                you cannot recall.
              </Text>
              {reviewChanged && (
                <>
                  <Text accessibilityRole="alert" style={[s.body, { color: colors.danger }]}>
                    This deck changed while you were reviewing it. Check the current cards before
                    publishing.
                  </Text>
                  <Button
                    title="Review latest cards"
                    size="compact"
                    variant="secondary"
                    disabled={!!result.busy || !currentReview}
                    onPress={beginPublication}
                  />
                </>
              )}
              {!!pendingPublication && (
                <Text accessibilityRole="alert" style={s.body}>
                  A previous publication response was interrupted. Retry the saved snapshot first;
                  current edits will not be published. Its saved download count is{' '}
                  {pendingPublication.showDownloadCount ? 'visible' : 'hidden'} and practice trends
                  are {pendingPublication.showUsageStats ? 'visible when eligible' : 'hidden'}. You
                  can change those settings after recovering the publication. Its saved cover may
                  differ from your current private deck image.
                </Text>
              )}
              {!!listing && (
                <Text style={s.caption}>
                  This creates a new version for future downloads. Existing copies will not change.
                  If a previous publish response was lost, retrying first recovers that saved
                  publication.
                </Text>
              )}
              {!listing && (
                <>
                  <MarketplaceToggle
                    title="Show download count"
                    detail="Off by default. Counts active accounts that downloaded this deck, once per account. You can show or hide it later."
                    value={pendingPublication?.showDownloadCount ?? downloadCount}
                    disabled={!!result.busy || !!pendingPublication}
                    onChange={setDownloadCount}
                  />
                  <MarketplaceToggle
                    title="Show practice trends"
                    detail="Off by default. Shows broad trends from the last 30 days with at least 5 consenting learners. Hiding trends does not stop contributions or delete reviews."
                    value={pendingPublication?.showUsageStats ?? usageStats}
                    disabled={!!result.busy || !!pendingPublication}
                    onChange={setUsageStats}
                  />
                </>
              )}
              <MarketplaceToggle
                title="I have the rights to share this deck and image"
                detail="I have reviewed the cards and image and agree to the community guidelines. I have permission to publish this material, including the cover image."
                value={rights}
                disabled={!!result.busy}
                onChange={setRights}
              />
              <MarketplaceGuidelines />
              <Button
                title={
                  pendingPublication
                    ? 'Retry saved publication'
                    : listing
                      ? 'Publish current changes'
                      : 'Publish public copy'
                }
                size="compact"
                disabled={!rights || !!result.busy || reviewChanged}
                loading={result.busy === 'publish'}
                onPress={() => void publish()}
              />
              <Button
                title="Cancel publication"
                size="compact"
                variant="ghost"
                disabled={!!result.busy}
                onPress={() => setConfirm(false)}
              />
            </>
          )}
        </>
      )}
    </Panel>
  );
}
