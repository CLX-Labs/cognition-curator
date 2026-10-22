import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useStore } from '../../src/store';
import { activeDeck, dueCards } from '../../src/repository';
import { Button, Empty, Field, Panel, Screen, colors, s, Text } from '../../src/ui';

export default function Decks() {
  const { data } = useStore();
  const [search, setSearch] = useState('');
  const due = dueCards(data);
  const query = search.trim().toLocaleLowerCase();
  const decks = data.decks.filter((deck) =>
    [deck.name, deck.description].some((value) => value.toLocaleLowerCase().includes(query)),
  );
  const create = () => router.push('/decks/new');
  return (
    <Screen
      title="Your decks"
      eyebrow="01 / YOUR COLLECTION"
      subtitle={data.decks.length + (data.decks.length === 1 ? ' deck' : ' decks')}
      action={<Button title="+ New deck" size="compact" onPress={create} />}
    >
      <Field
        label="Search decks"
        placeholder="Name or subject"
        value={search}
        onChangeText={setSearch}
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />
      {due.length > 0 && (
        <Panel tint>
          <View style={s.between}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={s.label}>Ready to review</Text>
              <Text style={s.caption}>{due.length} cards due across your decks</Text>
            </View>
            <Button title="Review" size="compact" onPress={() => router.push('/review')} />
          </View>
        </Panel>
      )}
      <View style={{ gap: 14 }}>
        {decks.map((deck) => {
          const count = data.cards.filter((card) => card.deckId === deck.id).length;
          const dueCount = due.filter((card) => card.deckId === deck.id).length;
          const paused = !activeDeck(deck);
          return (
            <Pressable
              key={deck.id}
              accessibilityRole="button"
              accessibilityLabel={'Open ' + deck.name + ', ' + count + ' cards'}
              onPress={() => router.push({ pathname: '/decks/[id]', params: { id: deck.id } })}
              style={({ pressed }) => ({ opacity: pressed ? 0.76 : 1 })}
            >
              <Panel style={{ padding: 20, borderLeftWidth: 4, borderLeftColor: deck.color }}>
                <View style={[s.row, { alignItems: 'flex-start' }]}>
                  <View
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 14,
                      backgroundColor: deck.color,
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 23 }}>{deck.icon || '▤'}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 5 }}>
                    <Text style={[s.sectionTitle, { fontSize: 18 }]}>{deck.name}</Text>
                    {!!deck.description && (
                      <Text numberOfLines={2} style={s.caption}>
                        {deck.description}
                      </Text>
                    )}
                    <Text style={s.caption}>
                      {count} {count === 1 ? 'card' : 'cards'}
                      {paused ? ' · Reviews paused' : dueCount ? ' · ' + dueCount + ' due' : ''}
                      {deck.version === 0 ? ' · On this device' : ''}
                    </Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 24 }}>›</Text>
                </View>
              </Panel>
            </Pressable>
          );
        })}
      </View>
      {!decks.length && (
        <Empty
          title={query ? 'No decks found' : 'Create your first deck'}
          detail={
            query
              ? 'Try another name or subject.'
              : 'Give it a name, then add your own cards or generate a few suggestions.'
          }
          action={
            query ? (
              <Button title="Clear search" variant="secondary" onPress={() => setSearch('')} />
            ) : (
              <Button title="Create deck" onPress={create} />
            )
          }
        />
      )}
    </Screen>
  );
}
