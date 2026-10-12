import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useStore } from '../../src/store';
import { activeDeck, dueCards } from '../../src/repository';
import { Button, Empty, Field, Panel, Screen, colors, s } from '../../src/ui';
export default function Decks() {
  const { data } = useStore();
  const [search, setSearch] = useState('');
  const due = dueCards(data);
  const decks = data.decks.filter((d) => d.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <Screen title="Practice your decks." eyebrow="PRACTICE">
      <Field
        label="Find a deck"
        placeholder="Search your collection"
        value={search}
        onChangeText={setSearch}
      />
      <Text style={s.body}>Choose a deck to practice, or review the cards due today.</Text>
      <Button
        title={'Review due cards (' + due.length + ')'}
        disabled={!due.length}
        onPress={() => router.push('/review')}
      />
      {decks.map((deck) => {
        const cards = data.cards.filter((c) => c.deckId === deck.id);
        return (
          <View key={deck.id}>
            <Panel>
              <View style={s.between}>
                <View
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 16,
                    backgroundColor: deck.color,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontSize: 25 }}>{deck.icon || '▤'}</Text>
                </View>
                {!activeDeck(deck) ? (
                  <Text style={s.caption}>PAUSED</Text>
                ) : (
                  <View style={s.pill}>
                    <Text style={s.pillText}>
                      {due.filter((c) => c.deckId === deck.id).length} DUE
                    </Text>
                  </View>
                )}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={'Open ' + deck.name}
                onPress={() =>
                  router.push({ pathname: '/decks/[id]', params: { id: deck.id } })
                }
              >
                <Text style={s.sectionTitle}>{deck.name} →</Text>
              </Pressable>
              {!!deck.description && (
                <Text numberOfLines={2} style={s.body}>
                  {deck.description}
                </Text>
              )}
              <Button
                title="Practice this deck"
                disabled={!cards.length}
                onPress={() =>
                  router.push({
                    pathname: '/review',
                    params: { deckId: deck.id, practice: 'true' },
                  })
                }
              />
              <Text style={s.caption}>
                {cards.length} cards{deck.version === 0 ? ' · saved on this device' : ''}
              </Text>
            </Panel>
          </View>
        );
      })}
      {!decks.length && (
        <Empty
          title={search ? 'No matching decks.' : 'An open shelf.'}
          detail={
            search
              ? 'Try a different name.'
              : 'Use Create to generate your first deck, then come here to practice.'
          }
        />
      )}
    </Screen>
  );
}
