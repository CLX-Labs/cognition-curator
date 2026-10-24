import React from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useStore } from '../../src/store';
import { dueCards } from '../../src/repository';
import { BrandHeader, Button, Empty, Panel, Screen, colors, s, Text } from '../../src/ui';
import { ReleaseStamp } from '../../src/release-panel';
import { useProfile } from '../../src/profile';
import Avatar from '../../src/avatar';
import { BrandPattern, DeckArtwork } from '../../src/brand-patterns';
import { MarketplaceEntry } from '../../src/marketplace-ui';

export default function Home() {
  const { data } = useStore();
  const { profile } = useProfile();
  const due = dueCards(data);
  const today = new Date().toDateString();
  const todayReviews = data.reviews.filter((r) => new Date(r.reviewedAt).toDateString() === today);
  const name = profile.name.split(' ')[0] || 'there';
  return (
    <Screen
      leading={<BrandHeader />}
      title={'Hey, ' + name + '.'}
      eyebrow={new Date().toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })}
      subtitle="A few minutes for what matters."
      action={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open your account"
          onPress={() => router.navigate('/profile')}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: colors.yellow,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Avatar name={profile.name} photoDataUrl={profile.photoDataUrl} size={44} />
        </Pressable>
      }
    >
      <Panel tint>
        <View style={s.between}>
          <View style={s.pill}>
            <Text style={s.pillText}>DAILY PRACTICE</Text>
          </View>
          <BrandPattern variant="orbit" width={64} height={28} />
        </View>
        <Text style={[s.editorial, { fontSize: 42, lineHeight: 46, color: colors.ink }]}>
          {due.length
            ? 'Ready when you are.'
            : data.cards.length
              ? 'All caught up.'
              : 'Start with a little curiosity.'}
        </Text>
        {!!data.cards.length && (
          <View style={[s.row, { alignItems: 'center', gap: 16 }]}>
            <Text style={[s.metric, { fontSize: 64, lineHeight: 72 }]}>
              {due.length || todayReviews.length}
            </Text>
            <Text style={[s.body, { flex: 1, color: colors.ink }]}>
              {due.length ? 'cards ready\nto review' : 'reviews\ncompleted today'}
            </Text>
          </View>
        )}
        <Text style={s.body}>
          {due.length
            ? 'Bring these ideas back to mind, one card at a time.'
            : data.cards.length
              ? 'You are up to date. Practice anytime, or add something new.'
              : 'Choose a subject. Create a few cards. Give what you learn a place to stay.'}
        </Text>
        <Button
          title={
            due.length
              ? 'Review ' + due.length + (due.length === 1 ? ' card' : ' cards') + '  →'
              : data.cards.length
                ? 'Practice anytime  →'
                : 'Create your first deck  →'
          }
          onPress={() => {
            if (due.length) router.push('/review');
            else if (data.cards.length)
              router.push({ pathname: '/review', params: { practice: 'true' } });
            else router.navigate('/generate');
          }}
        />
      </Panel>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create cards or a deck"
        onPress={() => router.navigate('/generate')}
        style={({ pressed }) => [pressed && { opacity: 0.75 }]}
      >
        <Panel style={{ gap: 12 }}>
          <View style={s.between}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.sectionTitle}>Learn something new</Text>
              <Text style={s.body}>Write a card or let AI get you started.</Text>
            </View>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 15,
                backgroundColor: colors.pale,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 26, color: colors.accent }}>+</Text>
            </View>
          </View>
        </Panel>
      </Pressable>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Panel>
            <Text style={s.metric}>{todayReviews.length}</Text>
            <Text style={s.caption}>Reviews today</Text>
          </Panel>
        </View>
        <View style={{ flex: 1 }}>
          <Panel>
            <Text style={s.metric}>{data.cards.length}</Text>
            <Text style={s.caption}>Cards in your library</Text>
          </Panel>
        </View>
      </View>
      <View style={s.between}>
        <Text style={[s.sectionTitle, { flex: 1 }]}>Your decks</Text>
        <Button
          title="View all →"
          size="compact"
          variant="ghost"
          onPress={() => router.navigate('/decks')}
        />
      </View>
      {data.decks.length ? (
        data.decks.slice(0, 3).map((deck) => (
          <Pressable
            key={deck.id}
            accessibilityRole="button"
            accessibilityLabel={'Open ' + deck.name}
            onPress={() => router.push({ pathname: '/decks/[id]', params: { id: deck.id } })}
          >
            <Panel>
              <View style={s.row}>
                <DeckArtwork id={deck.id} color={deck.color} icon={deck.icon} size={56} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.label, { fontSize: 17, lineHeight: 23 }]}>{deck.name}</Text>
                  <Text style={s.caption}>
                    {data.cards.filter((c) => c.deckId === deck.id).length} cards ·{' '}
                    {due.filter((c) => c.deckId === deck.id).length} due
                  </Text>
                </View>
                <Text style={s.body}>→</Text>
              </View>
            </Panel>
          </Pressable>
        ))
      ) : (
        <Empty
          title="Start with something you love."
          detail="A topic you are learning, notes from a book, or the details you always forget."
          action={
            <Button
              title="Make a deck"
              variant="secondary"
              onPress={() => router.navigate('/generate')}
            />
          }
        />
      )}
      <MarketplaceEntry />
      <ReleaseStamp />
    </Screen>
  );
}
