import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useStore } from '../../src/store';
import { activeDeck, deckContent, dueCards } from '../../src/repository';
import DeckForm from '../../src/deck-form';
import {
  Back,
  Button,
  Empty,
  Field,
  Panel,
  Screen,
  colors,
  reportError,
  s,
} from '../../src/ui';

export default function DeckDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, mutate } = useStore();
  const [editing, setEditing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(20);
  useEffect(() => {
    setVisibleCount(20);
    setSearch('');
    setSettingsOpen(false);
    setEditing(false);
  }, [id]);
  function searchCards(value: string) {
    setSearch(value);
    setVisibleCount(20);
  }
  const deck = data.decks.find((item) => item.id === id);
  if (!deck)
    return (
      <Screen leading={<Back label="Decks" />}>
        <Empty
          title="This deck is unavailable"
          detail="It may have been removed on another device."
        />
      </Screen>
    );
  const cards = data.cards.filter((card) => card.deckId === deck.id);
  const due = dueCards(data).filter((card) => card.deckId === deck.id);
  const query = search.trim().toLocaleLowerCase();
  const filtered = cards.filter((card) =>
    [card.front, card.back, ...card.tags].some((value) =>
      value.toLocaleLowerCase().includes(query),
    ),
  );
  const add = () =>
    router.push({ pathname: '/cards/[id]', params: { id: 'new', deckId: deck.id } });
  const generate = () =>
    router.dismissTo({ pathname: '/generate', params: { deckId: deck.id, fromDeck: 'true' } });
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
              .then(() => router.dismissTo('/decks'))
              .catch(reportError);
          },
        },
      ],
    );
  }
  return (
    <Screen
      title={deck.name}
      eyebrow="DECK"
      leading={
        <View style={s.between}>
          <Back label="Decks" />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: settingsOpen }}
            accessibilityLabel="Deck settings"
            style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }}
            onPress={() => {
              setSettingsOpen((open) => !open);
              setEditing(false);
            }}
          >
            <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '600' }}>
              Settings {settingsOpen ? '⌃' : '⌄'}
            </Text>
          </Pressable>
        </View>
      }
      action={
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            backgroundColor: deck.color,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 21 }}>{deck.icon || '▤'}</Text>
        </View>
      }
      subtitle={
        cards.length +
        ' cards · ' +
        (activeDeck(deck) ? due.length + ' due' : 'Reviews paused')
      }
      footer={
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Button title="+ Add card" size="compact" onPress={add} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Generate cards"
              size="compact"
              variant="secondary"
              onPress={generate}
            />
          </View>
        </View>
      }
    >
      {!!deck.description && (
        <Text numberOfLines={2} style={[s.body, { fontSize: 14, lineHeight: 20 }]}>
          {deck.description}
        </Text>
      )}
      <Panel style={{ padding: 16, gap: 10 }}>
        <Text style={s.label}>Add to this deck</Text>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Button title="+ Add card" size="compact" onPress={add} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Generate cards"
              size="compact"
              variant="secondary"
              onPress={generate}
            />
          </View>
        </View>
      </Panel>
      {cards.length > 0 && (
        <Button
          title={due.length ? 'Review ' + due.length + ' due cards' : 'Practice this deck'}
          variant="secondary"
          size="compact"
          onPress={() =>
            router.push({
              pathname: '/review',
              params: { deckId: deck.id, practice: due.length ? 'false' : 'true' },
            })
          }
        />
      )}
      {settingsOpen && (
        <Panel style={{ padding: 18 }}>
          {editing ? (
            <>
              <DeckForm deck={deck} complete={() => setEditing(false)} />
              <Button
                title="Cancel editing"
                variant="ghost"
                size="compact"
                onPress={() => setEditing(false)}
              />
            </>
          ) : (
            <>
              <Button
                title="Edit deck details"
                variant="secondary"
                size="compact"
                onPress={() => setEditing(true)}
              />
              <Text style={s.caption}>
                {activeDeck(deck)
                  ? 'Included in your daily review queue.'
                  : 'Daily reviews are paused. You can still practice.'}
              </Text>
              <Button
                title={activeDeck(deck) ? 'Pause daily reviews' : 'Resume daily reviews'}
                variant="secondary"
                size="compact"
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
              <Button
                title="Delete deck"
                variant="danger"
                size="compact"
                onPress={deleteDeck}
              />
            </>
          )}
        </Panel>
      )}
      {cards.length > 0 && (
        <Field
          label="Search cards"
          labelAction={
            <Text style={s.caption}>
              {query ? filtered.length + ' of ' : ''}
              {cards.length} cards
            </Text>
          }
          placeholder="Question, answer or tag"
          value={search}
          onChangeText={searchCards}
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      )}
      <View style={{ gap: 10 }}>
        {filtered.slice(0, visibleCount).map((card) => (
          <Pressable
            key={card.id}
            accessibilityRole="button"
            accessibilityLabel={'Edit card: ' + card.front}
            onPress={() => router.push({ pathname: '/cards/[id]', params: { id: card.id } })}
            style={({ pressed }) => ({ opacity: pressed ? 0.76 : 1 })}
          >
            <Panel style={{ padding: 18, gap: 9 }}>
              <View style={[s.between, { alignItems: 'flex-start' }]}>
                <Text
                  numberOfLines={3}
                  style={{
                    flex: 1,
                    fontSize: 16,
                    lineHeight: 23,
                    fontWeight: '600',
                    color: colors.ink,
                  }}
                >
                  {card.front}
                </Text>
                <Text style={{ fontSize: 22, color: colors.muted }}>›</Text>
              </View>
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
      </View>
      {filtered.length > 20 && (
        <View style={{ gap: 10 }}>
          <Text style={s.caption}>
            Showing {Math.min(visibleCount, filtered.length)} of {filtered.length} cards
          </Text>
          {visibleCount < filtered.length && (
            <Button
              title="Show more cards"
              variant="secondary"
              size="compact"
              onPress={() => setVisibleCount((count) => count + 20)}
            />
          )}
        </View>
      )}
      {!filtered.length && (
        <Empty
          title={query ? 'No cards found' : 'Add your first card'}
          detail={
            query
              ? 'Try a different question, answer or tag.'
              : 'Start with a question you want to remember, or generate suggestions for this deck.'
          }
          action={
            query ? (
              <Button
                title="Clear search"
                variant="secondary"
                onPress={() => searchCards('')}
              />
            ) : (
              <Button title="Generate suggestions" variant="secondary" onPress={generate} />
            )
          }
        />
      )}
    </Screen>
  );
}
