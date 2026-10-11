import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useStore } from '../src/store';
import { dueCards } from '../src/repository';
import { Button, Empty, Panel, Screen, colors, s } from '../src/ui';

export default function Home() {
  const { session, data } = useStore();
  const due = dueCards(data);
  const today = new Date().toDateString();
  const todayReviews = data.reviews.filter((r) => new Date(r.reviewedAt).toDateString() === today);
  const name = session?.user.name.split(' ')[0] ?? 'there';
  return (
    <Screen
      title={'Hey, ' + name + '.'}
      eyebrow={new Date().toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })}
      action={
        <Pressable
          onPress={() => router.push('/profile')}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: colors.green,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontWeight: '800', color: colors.ink }}>
            {name.slice(0, 1).toUpperCase()}
          </Text>
        </Pressable>
      }
    >
      <Panel tint>
        <View style={s.pill}>
          <Text style={s.pillText}>A LITTLE EVERY DAY</Text>
        </View>
        <Text style={[s.title, { fontSize: 34 }]}>
          {due.length
            ? 'Keep it fresh.'
            : todayReviews.length
              ? 'Nice work today.'
              : 'Make room for\nwhat matters.'}
        </Text>
        <View style={[s.row, { alignItems: 'baseline' }]}>
          <Text style={[s.metric, { fontSize: 64 }]}>{due.length}</Text>
          <Text style={s.body}>cards ready to review</Text>
        </View>
        <Text style={s.body}>
          {due.length
            ? 'A few focused minutes now will make your next recall easier.'
            : data.cards.length
              ? 'You are up to date. Practice anytime, or add something new.'
              : 'Your next good idea deserves a place to stay.'}
        </Text>
        <Button
          title={
            due.length
              ? 'Start a review  →'
              : data.cards.length
                ? 'Practice your cards  →'
                : 'Create your first deck  →'
          }
          onPress={() =>
            router.push(
              due.length
                ? '/review'
                : data.cards.length
                  ? { pathname: '/review', params: { practice: 'true' } }
                  : '/decks/new',
            )
          }
        />
      </Panel>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Panel>
            <Text style={s.metric}>{todayReviews.length}</Text>
            <Text style={s.caption}>REVIEWS TODAY</Text>
          </Panel>
        </View>
        <View style={{ flex: 1 }}>
          <Panel>
            <Text style={s.metric}>{data.cards.length}</Text>
            <Text style={s.caption}>CARDS IN YOUR LIBRARY</Text>
          </Panel>
        </View>
      </View>
      <View style={s.between}>
        <Text style={s.sectionTitle}>Your collection</Text>
        <Pressable onPress={() => router.push('/decks')}>
          <Text style={{ color: colors.accent, fontWeight: '700' }}>View all →</Text>
        </Pressable>
      </View>
      {data.decks.length ? (
        data.decks.slice(0, 3).map((deck) => (
          <Pressable
            key={deck.id}
            onPress={() => router.push({ pathname: '/decks/[id]', params: { id: deck.id } })}
          >
            <Panel>
              <View style={s.row}>
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 13,
                    backgroundColor: deck.color,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 22 }}>{deck.icon || '▤'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>{deck.name}</Text>
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
              onPress={() => router.push('/decks/new')}
            />
          }
        />
      )}
      <Pressable onPress={() => router.push('/generate')}>
        <Panel>
          <Text style={s.eyebrow}>FROM CURIOSITY TO CARDS</Text>
          <Text style={s.sectionTitle}>Give your learning a head start.</Text>
          <Text style={s.body}>Draft cards with AI, then make them your own. →</Text>
        </Panel>
      </Pressable>
    </Screen>
  );
}
