import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import type { Deck } from '@recollect/contracts';
import { useStore } from './store';
import { Button, Field, colors, reportError, s, Text } from './ui';
import { DeckArtwork } from './brand-patterns';
import { chooseDeckPhoto } from './deck-photo';

export default function DeckForm({ deck, complete }: { deck?: Deck; complete?(): void }) {
  const { repository, mutate } = useStore();
  const [baseline] = useState(deck);
  const [formOwner] = useState(repository?.ownerId);
  const [id] = useState(() => deck?.id ?? repository?.newId() ?? '');
  const [name, setName] = useState(deck?.name ?? '');
  const [description, setDescription] = useState(deck?.description ?? '');
  const [color, setColor] = useState(deck?.color ?? colors.yellow);
  const [icon, setIcon] = useState(deck?.icon ?? '📚');
  const [imageDataUrl, setImageDataUrl] = useState(deck?.imageDataUrl);
  const [imageError, setImageError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [busy, setBusy] = useState<'save' | 'image' | null>(null);
  const inFlight = useRef(false);
  const scope = useRef(0);
  const owner = useRef(repository?.ownerId);
  owner.current = repository?.ownerId;
  useEffect(() => {
    ++scope.current;
    inFlight.current = false;
    setBusy(null);
    return () => {
      ++scope.current;
    };
  }, [repository]);
  async function pickImage() {
    if (inFlight.current || owner.current !== formOwner) return;
    inFlight.current = true;
    const epoch = scope.current,
      expectedOwner = owner.current;
    setBusy('image');
    setImageError(null);
    try {
      const photo = await chooseDeckPhoto();
      if (photo && scope.current === epoch && owner.current === expectedOwner)
        setImageDataUrl(photo);
    } catch (cause) {
      if (scope.current === epoch && owner.current === expectedOwner)
        setImageError(
          cause instanceof Error ? cause.message : 'This image could not be opened. Try again.',
        );
    } finally {
      if (scope.current === epoch && owner.current === expectedOwner) {
        inFlight.current = false;
        setBusy(null);
      }
    }
  }
  async function save() {
    if (!id || !name.trim() || inFlight.current) return;
    if (owner.current !== formOwner) return;
    inFlight.current = true;
    const epoch = scope.current,
      expectedOwner = owner.current;
    setBusy('save');
    try {
      await mutate((repo) => {
        if (repo.ownerId !== formOwner || (baseline && baseline.ownerId !== repo.ownerId))
          throw new Error('The signed-in account changed. Open this deck again before saving.');
        return repo.saveDeck(
          {
            id,
            name: name.trim(),
            description,
            color,
            icon,
            ...(imageDataUrl === undefined ? {} : { imageDataUrl }),
            isSilenced: baseline?.isSilenced ?? false,
            silencedUntil: baseline?.silencedUntil ?? null,
          },
          baseline,
        );
      });
      if (scope.current !== epoch || owner.current !== expectedOwner) return;
      if (complete) complete();
      else router.replace({ pathname: '/decks/[id]', params: { id } });
    } catch (error) {
      if (scope.current === epoch && owner.current === expectedOwner) reportError(error);
    } finally {
      if (scope.current === epoch && owner.current === expectedOwner) {
        inFlight.current = false;
        setBusy(null);
      }
    }
  }
  return (
    <View style={{ gap: 18 }}>
      <Field
        label="Deck name"
        placeholder="e.g. Spanish verbs or World history"
        value={name}
        maxLength={200}
        editable={busy === null}
        onChangeText={setName}
      />
      <View style={{ gap: 12 }}>
        <Text style={s.label}>Deck image</Text>
        <View style={[s.row, { alignItems: 'center', gap: 18 }]}>
          <DeckArtwork id={id} color={color} icon={icon} imageDataUrl={imageDataUrl} size={112} />
          <View style={{ flex: 1, gap: 8 }}>
            <Button
              title={imageDataUrl ? 'Change image' : 'Choose image'}
              variant="secondary"
              size="compact"
              loading={busy === 'image'}
              disabled={busy !== null}
              onPress={() => void pickImage()}
            />
            {!!imageDataUrl && (
              <Button
                title="Use default artwork"
                variant="ghost"
                size="compact"
                disabled={busy !== null}
                onPress={() => {
                  setImageDataUrl(null);
                  setImageError(null);
                }}
              />
            )}
          </View>
        </View>
        <Text style={s.caption}>
          Shared copies use the image from the snapshot you send. To change a published cover,
          choose “Update published copy.”
        </Text>
        {!!imageError && (
          <Text accessibilityRole="alert" style={[s.caption, { color: colors.danger }]}>
            {imageError}
          </Text>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: detailsOpen }}
        disabled={busy !== null}
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
            editable={busy === null}
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
                disabled={busy !== null}
                onPress={() => setIcon(value)}
                style={{
                  backgroundColor: icon === value ? colors.yellow : colors.paper,
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
              [colors.yellow, 'Citron'],
              [colors.lilac, 'Lilac'],
              ['#CFD5F9', 'Periwinkle'],
              ['#EFD4C5', 'Apricot'],
              ['#D8E2CD', 'Sage'],
            ].map(([value, label]) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: value === color }}
                accessibilityLabel={'Choose ' + label}
                disabled={busy !== null}
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
        disabled={!name.trim() || !id || busy !== null}
        loading={busy === 'save'}
        onPress={() => void save()}
      />
    </View>
  );
}
