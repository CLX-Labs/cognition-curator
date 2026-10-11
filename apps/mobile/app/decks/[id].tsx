import React, { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useStore } from '../../src/store';
import { activeDeck, deckContent, dueCards } from '../../src/repository';
import DeckForm from '../../src/deck-form';
import { Back, Button, Empty, Panel, Screen, colors, reportError, s } from '../../src/ui';
export default function DeckDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, mutate } = useStore();
  const [editing, setEditing] = useState(false);
  const deck = data.decks.find((d) => d.id === id);
  if (!deck)
    return (
      <Screen tabs={false}>
        <Back />
        <Empty
          title="This deck is unavailable."
          detail="It may have been removed on another device."
        />
      </Screen>
    );
  const cards = data.cards.filter((c) => c.deckId === deck.id);
  const due = dueCards(data).filter((c) => c.deckId === deck.id);
  function deleteDeck() {
    const displayed = deck;
    if (!displayed) return;
    Alert.alert(
      'Delete ' + displayed.name + '?',
      'The deck and its cards will be removed from your library and synchronized to your account.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete deck',
          style: 'destructive',
          onPress: () => {
            void mutate((repo) => repo.remove('deck', displayed.id, displayed))
              .then(() => router.replace('/decks'))
              .catch(reportError);
          },
        },
      ],
    );
  }
  return (
    <Screen
      title={deck.name}
      eyebrow={cards.length + ' CARDS · ' + due.length + ' DUE'}
      tabs={false}
    >
      <Back label="Library" />
      {editing ? (
        <Panel>
          <DeckForm deck={deck} complete={() => setEditing(false)} />
          <Button title="Cancel editing" variant="secondary" onPress={() => setEditing(false)} />
        </Panel>
      ) : (
        <>
          {!!deck.description && <Text style={s.body}>{deck.description}</Text>}
          <Button
            title={due.length ? 'Review ' + due.length + ' cards  →' : 'Practice this deck  →'}
            disabled={!cards.length}
            onPress={() =>
              router.push({
                pathname: '/review',
                params: { deckId: id, practice: due.length ? 'false' : 'true' },
              })
            }
          />
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Button
                title="+ Add a card"
                variant="secondary"
                onPress={() =>
                  router.push({ pathname: '/cards/[id]', params: { id: 'new', deckId: id } })
                }
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title="Draft with AI"
                variant="secondary"
                onPress={() => router.push({ pathname: '/generate', params: { deckId: id } })}
              />
            </View>
          </View>
          <View style={s.between}>
            <Text style={s.sectionTitle}>Cards</Text>
            <Pressable onPress={() => setEditing(true)}>
              <Text style={{ color: colors.accent, fontWeight: '700' }}>Edit deck</Text>
            </Pressable>
          </View>
          {cards.map((card) => (
            <Pressable
              key={card.id}
              onPress={() => router.push({ pathname: '/cards/[id]', params: { id: card.id } })}
            >
              <Panel>
                <Text style={s.label}>{card.front}</Text>
                <Text numberOfLines={2} style={s.body}>
                  {card.back}
                </Text>
                <Text style={s.caption}>
                  {card.schedule.phase === 'new'
                    ? 'New card'
                    : 'Next review ' + new Date(card.schedule.dueAt).toLocaleDateString()}
                  {card.aiGenerated ? ' · AI assisted' : ''}
                </Text>
              </Panel>
            </Pressable>
          ))}
          {!cards.length && (
            <Empty
              title="Something worth remembering."
              detail="Add your own question and answer, or use AI to make a first draft."
            />
          )}
          <Panel>
            <Text style={s.sectionTitle}>Review settings</Text>
            <Text style={s.body}>
              {activeDeck(deck)
                ? 'This deck is included in your daily review queue.'
                : 'This deck is paused. You can still practice its cards.'}
            </Text>
            <Button
              title={activeDeck(deck) ? 'Pause daily reviews' : 'Resume daily reviews'}
              variant="secondary"
              onPress={() =>
                void mutate((repo) =>
                  repo.saveDeck(
                    {
                      ...deckContent(deck),
                      isSilenced: activeDeck(deck),
                      silencedUntil: null,
                    },
                    deck,
                  ),
                ).catch(reportError)
              }
            />
            <Button title="Delete deck" variant="danger" onPress={deleteDeck} />
          </Panel>
        </>
      )}
    </Screen>
  );
}
