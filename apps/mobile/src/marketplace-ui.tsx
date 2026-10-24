import React, { useState } from 'react';
import { Alert, Linking, Pressable, Switch, View } from 'react-native';
import { router } from 'expo-router';
import type { MarketplaceListing } from '@recollect/contracts';
import { BrandPattern, DeckArtwork } from './brand-patterns';
import { marketplaceApi } from './marketplace-api';
import { useCommunityResource } from './community-api';
import { Button, Field, Panel, Text, colors, reportError, s } from './ui';

export function MarketplaceFeedback({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string | null;
  retry(): void;
}) {
  if (error)
    return (
      <View style={{ gap: 8 }}>
        <Text accessibilityRole="alert" style={[s.body, { color: colors.danger }]}>
          {error}
        </Text>
        <Button title="Try again" variant="secondary" size="compact" onPress={retry} />
      </View>
    );
  return loading ? (
    <Text accessibilityLiveRegion="polite" style={s.caption}>
      Opening the marketplace…
    </Text>
  ) : null;
}

export function MarketplaceToggle({
  title,
  detail,
  value,
  disabled,
  onChange,
}: {
  title: string;
  detail: string;
  value: boolean;
  disabled?: boolean;
  onChange(enabled: boolean): void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <View style={s.between}>
        <Text style={[s.label, { flex: 1 }]}>{title}</Text>
        <Switch
          accessibilityLabel={title}
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          trackColor={{ false: colors.line, true: colors.accent }}
        />
      </View>
      <Text style={s.caption}>{detail}</Text>
    </View>
  );
}

export function MarketplaceMetrics({ listing }: { listing: MarketplaceListing }) {
  const usage = listing.showUsageStats ? listing.usageStats : null;
  const recall =
    usage?.recallBand === 'mostly_remembered'
      ? 'Mostly remembered'
      : usage?.recallBand === 'mostly_not_sure'
        ? 'Mostly unsure'
        : 'Mixed recall';
  return (
    <View style={{ gap: 7 }}>
      {listing.showDownloadCount && listing.downloadCount !== null && (
        <Text style={s.caption}>
          {listing.downloadCount} {listing.downloadCount === 1 ? 'download' : 'downloads'}
        </Text>
      )}
      {!!usage && (
        <View style={{ gap: 3 }}>
          <Text style={s.eyebrow}>PRACTICE / LAST 30 DAYS</Text>
          <Text style={s.caption}>
            {usage.learnerBand} contributing learners · {usage.reviewBand} reviews
          </Text>
          <Text style={s.caption}>{recall}</Text>
        </View>
      )}
    </View>
  );
}

export function MarketplaceListingCard({ listing }: { listing: MarketplaceListing }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={'Preview ' + listing.deck.name}
      onPress={() => router.push({ pathname: '/marketplace/[id]', params: { id: listing.id } })}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
    >
      <Panel
        style={{ padding: 20, gap: 12, borderLeftWidth: 4, borderLeftColor: listing.deck.color }}
      >
        <View style={[s.row, { alignItems: 'flex-start' }]}>
          <DeckArtwork
            id={listing.id}
            color={listing.deck.color}
            icon={listing.deck.icon}
            imageDataUrl={listing.deck.imageDataUrl}
            size={60}
          />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.sectionTitle}>{listing.deck.name}</Text>
            <Text style={s.caption}>
              By {listing.publisher.name} · {listing.cardCount} cards
            </Text>
            {!!listing.deck.description && (
              <Text numberOfLines={2} style={s.caption}>
                {listing.deck.description}
              </Text>
            )}
          </View>
          <Text style={{ color: colors.accent, fontSize: 24 }}>›</Text>
        </View>
        <MarketplaceMetrics listing={listing} />
        {!!listing.download && (
          <Text style={s.caption}>
            Downloaded version {listing.download.version}
            {listing.download.version < listing.version ? ' · Newer publication available' : ''}
          </Text>
        )}
        {!listing.isPublished && <Text style={s.caption}>Unpublished · visible only to you</Text>}
      </Panel>
    </Pressable>
  );
}

export function MarketplaceEntry() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Explore the deck marketplace"
      onPress={() => router.push('/marketplace')}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
    >
      <Panel tint style={{ gap: 10 }}>
        <View style={s.between}>
          <Text style={s.eyebrow}>LEARN FROM EACH OTHER</Text>
          <BrandPattern variant="orbit" width={50} height={24} />
        </View>
        <Text style={[s.editorial, { fontSize: 30, lineHeight: 36 }]}>
          A little shared curiosity.
        </Text>
        <Text style={s.body}>Explore community decks. Keep a copy. Make it your own.</Text>
        <Text style={[s.label, { color: colors.accent }]}>Explore the marketplace →</Text>
      </Panel>
    </Pressable>
  );
}

export function MarketplaceGuidelines() {
  return (
    <Button
      title="Community guidelines ↗"
      variant="ghost"
      size="compact"
      onPress={() =>
        void Linking.openURL('https://recollect-ai.netlify.app/community-guidelines/').catch(
          reportError,
        )
      }
    />
  );
}

export function MarketplaceSafety({ listing }: { listing: MarketplaceListing }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<'inappropriate' | 'harassment' | 'spam' | 'other'>(
    'inappropriate',
  );
  const [details, setDetails] = useState('');
  const [sent, setSent] = useState(false);
  const action = useCommunityResource('marketplace-safety:' + listing.id, async () => true, false);
  const reasons = [
    ['inappropriate', 'Inappropriate content'],
    ['harassment', 'Harassment'],
    ['spam', 'Spam'],
    ['other', 'Something else'],
  ] as const;
  async function report() {
    const result = await action.run('report', (ownerId) =>
      marketplaceApi.report(ownerId, listing.id, {
        reason,
        ...(details.trim() ? { details: details.trim() } : {}),
      }),
    );
    if (result) {
      setSent(true);
      setOpen(false);
      setDetails('');
    }
  }
  function block() {
    Alert.alert(
      'Block ' + listing.publisher.name + '?',
      'Their marketplace decks will disappear for you, and your aggregate practice contribution to them will stop. Existing downloaded copies stay in your library. This also ends any friendship and shared recall access between you.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block publisher',
          style: 'destructive',
          onPress: () =>
            void action
              .run('block', (ownerId) => marketplaceApi.block(ownerId, listing.id))
              .then((done) => {
                if (done) router.dismissTo('/marketplace');
              }),
        },
      ],
    );
  }
  return (
    <Panel>
      <Text style={s.sectionTitle}>Keep this a good place to learn.</Text>
      {sent && (
        <Text accessibilityLiveRegion="polite" style={s.label}>
          Report received. Thank you for letting us know.
        </Text>
      )}
      <MarketplaceFeedback loading={false} error={action.error} retry={() => setOpen(true)} />
      {open ? (
        <>
          {reasons.map(([value, title]) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ selected: reason === value }}
              disabled={!!action.busy}
              onPress={() => setReason(value)}
              style={[s.row, { minHeight: 44 }]}
            >
              <Text style={{ color: colors.accent }}>{reason === value ? '●' : '○'}</Text>
              <Text style={s.label}>{title}</Text>
            </Pressable>
          ))}
          <Field
            label="Anything else we should know?"
            hint="Optional. Avoid passwords or unrelated personal information."
            value={details}
            onChangeText={setDetails}
            multiline
            maxLength={2000}
            editable={!action.busy}
          />
          <Button
            title="Send report"
            size="compact"
            disabled={!!action.busy}
            loading={action.busy === 'report'}
            onPress={() => void report()}
          />
          <Button
            title="Cancel report"
            size="compact"
            variant="ghost"
            disabled={!!action.busy}
            onPress={() => setOpen(false)}
          />
        </>
      ) : (
        <Button
          title="Report this deck"
          variant="secondary"
          size="compact"
          disabled={!!action.busy}
          onPress={() => {
            setSent(false);
            setOpen(true);
          }}
        />
      )}
      <Button
        title={'Block ' + listing.publisher.name}
        variant="ghost"
        size="compact"
        disabled={!!action.busy}
        loading={action.busy === 'block'}
        onPress={block}
      />
      <MarketplaceGuidelines />
    </Panel>
  );
}

export function MarketplaceUsageConsent({
  enabled,
  disabled,
  onChange,
}: {
  enabled: boolean;
  disabled?: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <MarketplaceToggle
      title="Contribute my practice activity"
      value={enabled}
      disabled={disabled}
      onChange={onChange}
      detail="Include my reviews of these downloaded cards in broad marketplace trends. Results appear only with at least 5 contributing learners, and only if the publisher shows usage. Your name, answers, and individual history are never shown here. Turning this off removes your past and future contribution."
    />
  );
}
