import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import type { MarketplaceListing } from '@recollect/contracts';
import { useCommunityResource } from '../../src/community-api';
import { marketplaceApi } from '../../src/marketplace-api';
import {
  MarketplaceFeedback,
  MarketplaceGuidelines,
  MarketplaceListingCard,
} from '../../src/marketplace-ui';
import { BrandPattern } from '../../src/brand-patterns';
import { Back, Button, Empty, Field, Screen, Text, s } from '../../src/ui';

export default function Marketplace() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [mine, setMine] = useState(false);
  const result = useCommunityResource('marketplace:' + mine + ':' + query, (ownerId) =>
    mine
      ? marketplaceApi.mine(ownerId).then((data) => ({ ...data, nextCursor: null }))
      : marketplaceApi.catalog(ownerId, query),
  );
  const identity = result.ownerId + ':' + mine + ':' + query;
  const [more, setMore] = useState<{
    identity: string;
    listings: MarketplaceListing[];
    cursor: string | null;
  } | null>(null);
  // A fresh first page replaces pagination; search and account changes cannot reuse old results.
  useEffect(() => {
    setMore(null);
  }, [result.data, identity]);
  const extra = more?.identity === identity ? more : null;
  const listings = [...(result.data?.listings ?? []), ...(extra?.listings ?? [])].filter(
    (listing, index, all) => all.findIndex((item) => item.id === listing.id) === index,
  );
  const cursor = extra ? extra.cursor : result.data?.nextCursor;
  async function nextPage() {
    if (!cursor || mine) return;
    const page = await result.run('more', (ownerId) =>
      marketplaceApi.catalog(ownerId, query, cursor),
    );
    if (page)
      setMore((previous) => ({
        identity,
        listings: [...(previous?.identity === identity ? previous.listings : []), ...page.listings],
        cursor: page.nextCursor,
      }));
  }
  return (
    <Screen
      title="The marketplace"
      eyebrow="SHARED CURIOSITY"
      leading={<Back label="Your decks" onPress={() => router.dismissTo('/decks')} />}
      action={<BrandPattern variant="flow" width={56} height={56} />}
      subtitle="Good ideas are even better shared."
    >
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Button
            title="Explore decks"
            size="compact"
            variant={mine ? 'secondary' : 'primary'}
            disabled={!!result.busy}
            onPress={() => setMine(false)}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            title="My publications"
            size="compact"
            variant={mine ? 'primary' : 'secondary'}
            disabled={!!result.busy}
            onPress={() => setMine(true)}
          />
        </View>
      </View>
      <View style={s.between}>
        <Button
          title="Downloads & privacy →"
          variant="ghost"
          size="compact"
          onPress={() => router.push('/marketplace/downloads')}
        />
        <Button
          title="Refresh"
          variant="ghost"
          size="compact"
          disabled={!!result.busy || result.loading}
          onPress={() => void result.refresh()}
        />
      </View>
      {!mine && (
        <View style={[s.row, { alignItems: 'flex-end' }]}>
          <View style={{ flex: 1 }}>
            <Field
              label="Find something to learn"
              placeholder="Name or subject"
              value={search}
              onChangeText={setSearch}
              returnKeyType="search"
              autoCorrect={false}
              maxLength={100}
              onSubmitEditing={() => setQuery(search.trim())}
            />
          </View>
          <Button
            title="Search decks"
            size="compact"
            variant="secondary"
            disabled={!!result.busy}
            onPress={() => setQuery(search.trim())}
          />
        </View>
      )}
      {mine && (
        <Text style={s.body}>
          Publish from a deck in your library. Changes stay private until you explicitly update its
          published copy.
        </Text>
      )}
      <MarketplaceFeedback
        loading={result.loading}
        error={result.error}
        retry={() => void result.refresh()}
      />
      {listings.map((listing) => (
        <MarketplaceListingCard key={listing.id} listing={listing} />
      ))}
      {!!result.data && !listings.length && !result.loading && (
        <Empty
          title={
            mine
              ? 'Your next idea could live here.'
              : query
                ? 'No decks found.'
                : 'Be an early contributor.'
          }
          detail={
            mine
              ? 'Open a deck and choose Marketplace to publish a copy.'
              : query
                ? 'Try a broader subject or another search.'
                : 'Community decks will appear here as people publish them.'
          }
          action={
            mine ? (
              <Button
                title="Open your decks"
                variant="secondary"
                onPress={() => router.dismissTo('/decks')}
              />
            ) : undefined
          }
        />
      )}
      {!!cursor && (
        <Button
          title="More decks"
          variant="secondary"
          size="compact"
          disabled={!!result.busy}
          loading={result.busy === 'more'}
          onPress={() => void nextPage()}
        />
      )}
      <MarketplaceGuidelines />
    </Screen>
  );
}
