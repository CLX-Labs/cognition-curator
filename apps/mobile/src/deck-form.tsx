import React, { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { Deck } from '@recollect/contracts';
import { useStore } from './store';
import { Button, Field, colors, reportError, s } from './ui';

export default function DeckForm({ deck, complete }: { deck?: Deck; complete?(): void }) {
  const { repository, mutate } = useStore();
  const [baseline] = useState(deck);
  const [id] = useState(() => deck?.id ?? repository?.newId() ?? '');
  const [name, setName] = useState(deck?.name ?? '');
  const [description, setDescription] = useState(deck?.description ?? '');
  const [color, setColor] = useState(deck?.color ?? '#DDE8D9');
  const [icon, setIcon] = useState(deck?.icon ?? '📚');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  async function save() {
    if (!id || !name.trim() || saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
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
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 18 }}>
      <Field
        label="Deck name"
        placeholder="e.g. Spanish verbs or World history"
        value={name}
        maxLength={200}
        editable={!busy}
        onChangeText={setName}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: detailsOpen }}
        onPress={() => setDetailsOpen((open) => !open)}
        style={[s.between, { minHeight: 48, paddingVertical: 8 }]}
      >
        <View style={[s.row, { flex: 1 }]}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 21 }}>{icon}</Text>
          </View>
          <Text style={s.label}>Description & appearance</Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 19 }}>{detailsOpen ? '−' : '+'}</Text>
      </Pressable>
      {detailsOpen && (
        <>
          <Field
            label="Description"
            hint="Optional. Add a little context for this deck."
            placeholder="What do you want to learn?"
            multiline
            maxLength={10000}
            value={description}
            editable={!busy}
            onChangeText={setDescription}
          />
          <Text style={s.label}>Icon</Text>
          <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>
            {['📚', '🧠', '🌱', '💻', '✈️', '🧬', '🎨', '💡'].map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: icon === value }}
                accessibilityLabel={'Choose ' + value}
                disabled={busy}
                onPress={() => setIcon(value)}
                style={{
                  backgroundColor: icon === value ? colors.green : colors.paper,
                  borderRadius: 12,
                  width: 48,
                  height: 48,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: icon === value ? colors.ink : colors.line,
                }}
              >
                <Text style={{ fontSize: 22 }}>{value}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.label}>Color</Text>
          <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>
            {[
              ['#DDE8D9', 'Sage'],
              ['#F6D9C5', 'Peach'],
              ['#DCE5F3', 'Blue'],
              ['#E8DEF3', 'Lavender'],
              ['#F4E9B8', 'Yellow'],
            ].map(([value, label]) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: value === color }}
                accessibilityLabel={'Choose ' + label}
                disabled={busy}
                onPress={() => setColor(value!)}
                style={{
                  width: 44,
                  height: 44,
                  backgroundColor: value,
                  borderRadius: 22,
                  borderWidth: value === color ? 3 : 1,
                  borderColor: value === color ? colors.ink : colors.line,
                }}
              />
            ))}
          </View>
        </>
      )}
      <Button
        title={deck ? 'Save changes' : 'Create deck'}
        disabled={!name.trim() || !id}
        loading={busy}
        onPress={() => void save()}
      />
    </View>
  );
}
