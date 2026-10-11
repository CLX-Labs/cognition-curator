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
    <Screen title="Your library." eyebrow="A PLACE FOR WHAT YOU KNOW">
      <Field
        label="Find a deck"
        placeholder="Search your collection"
        value={search}
        onChangeText={setSearch}
      />
      <Button title="+ Create a deck" onPress={() => router.push('/decks/new')} />
      {decks.map((deck) => {
        const cards = data.cards.filter((c) => c.deckId === deck.id);
        return (
          <Pressable
            key={deck.id}
            onPress={() => router.push({ pathname: '/decks/[id]', params: { id: deck.id } })}
          >
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
              <Text style={s.sectionTitle}>{deck.name}</Text>
              {!!deck.description && (
                <Text numberOfLines={2} style={s.body}>
                  {deck.description}
                </Text>
              )}
              <Text style={s.caption}>
                {cards.length} cards{deck.version === 0 ? ' · saved on this device' : ''}
              </Text>
            </Panel>
          </Pressable>
        );
      })}
      {!decks.length && (
        <Empty
          title={search ? 'No matching decks.' : 'An open shelf.'}
          detail={
            search
              ? 'Try a different name.'
              : 'Create your first deck and add the things you want to remember.'
          }
        />
      )}
    </Screen>
  );
}
