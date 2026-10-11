import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { Deck } from '@recollect/contracts';
import { useStore } from './store';
import { Button, Field, colors, reportError, s } from './ui';
export default function DeckForm({ deck, complete }: { deck?: Deck; complete?(): void }) {
  const { repository, mutate } = useStore();
  const [baseline] = useState(deck);
  const [name, setName] = useState(deck?.name ?? '');
  const [description, setDescription] = useState(deck?.description ?? '');
  const [color, setColor] = useState(deck?.color ?? '#DDE8D9');
  const [icon, setIcon] = useState(deck?.icon ?? '📚');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const id = deck?.id ?? repository!.newId();
      await mutate((repo) =>
        repo.saveDeck(
          {
            id,
            name: name.trim(),
            description,
            color,
            icon,
            isSilenced: baseline?.isSilenced ?? false,
            silencedUntil: baseline?.silencedUntil ?? null,
          },
          baseline,
        ),
      );
      if (complete) complete();
      else router.replace({ pathname: '/decks/[id]', params: { id } });
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 18 }}>
      <Field
        label="Deck name"
        placeholder="What are you learning?"
        value={name}
        maxLength={200}
        onChangeText={setName}
      />
      <Field
        label="Description"
        placeholder="A little context for your collection"
        multiline
        maxLength={10000}
        value={description}
        onChangeText={setDescription}
      />
      <Text style={s.label}>Make it yours</Text>
      <View style={[s.row, { flexWrap: 'wrap' }]}>
        {['📚', '🧠', '🌱', '💻', '✈️', '🧬', '🎨', '💡'].map((value) => (
          <Pressable
            key={value}
            accessibilityLabel={'Choose ' + value}
            onPress={() => setIcon(value)}
            style={{
              backgroundColor: icon === value ? colors.green : '#fff',
              borderRadius: 12,
              padding: 12,
            }}
          >
            <Text style={{ fontSize: 22 }}>{value}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.row}>
        {['#DDE8D9', '#F6D9C5', '#DCE5F3', '#E8DEF3', '#F4E9B8'].map((value) => (
          <Pressable
            key={value}
            accessibilityLabel={'Choose color ' + value}
            onPress={() => setColor(value)}
            style={{
              width: 40,
              height: 40,
              backgroundColor: value,
              borderRadius: 20,
              borderWidth: value === color ? 3 : 0,
              borderColor: colors.ink,
            }}
          />
        ))}
      </View>
      <Button
        title={deck ? 'Save changes' : 'Create deck'}
        disabled={!name.trim()}
        loading={busy}
        onPress={() => void save()}
      />
    </View>
  );
}
