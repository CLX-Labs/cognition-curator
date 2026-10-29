import React, { useRef, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useStore } from '../../src/store';
import {
  cadenceDraft,
  categorySummary,
  parseCadence,
  settingsInput,
} from '../../src/category-model';
import { CadenceEditor, ReviewToggle } from '../../src/review-settings-ui';
import {
  Back,
  Button,
  Empty,
  Field,
  Panel,
  Screen,
  Text,
  colors,
  reportError,
  s,
} from '../../src/ui';
import { DeckArtwork } from '../../src/brand-patterns';
import { useActionScope } from '../../src/use-action-scope';

export default function CategoryDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CategoryDetailSession key={id} id={id} />;
}

function CategoryDetailSession({ id }: { id: string }) {
  const { data, mutate, repository } = useStore();
  const actionScope = useActionScope(repository?.ownerId);
  const category = data.reviewSettings?.categories.find((item) => item.id === id);
  const uncategorized = id === 'uncategorized';
  const scope = uncategorized ? null : id;
  const summary = categorySummary(data, scope);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const owner = repository?.ownerId;
  async function run(action: Parameters<typeof mutate>[0]) {
    const live = actionScope();
    if (!live() || saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      await mutate((repo) => {
        if (!live() || repo.ownerId !== owner) throw new Error('The signed-in account changed.');
        return action(repo);
      });
    } catch (error) {
      if (live()) reportError(error);
    } finally {
      if (live()) {
        saving.current = false;
        setBusy(false);
      }
    }
  }
  if (!category && !uncategorized)
    return (
      <Screen leading={<Back />}>
        <Empty
          title="Category unavailable"
          detail="It may have been removed on another device. Your decks are still in your library."
        />
      </Screen>
    );
  const paused = data.reviewSettings?.reviewEnabled === false || category?.reviewEnabled === false;
  const assigned = new Set(summary.decks.map((deck) => deck.id));
  const available = data.decks.filter(
    (deck) => !assigned.has(deck.id) && deck.name.toLowerCase().includes(search.toLowerCase()),
  );
  const review = (practice: boolean) =>
    router.push({ pathname: '/review', params: { categoryId: id, practice: String(practice) } });
  return (
    <Screen
      title={category?.name ?? 'Uncategorized'}
      eyebrow="CATEGORY"
      leading={<Back label="Categories" />}
      subtitle={`${summary.decks.length} decks · ${summary.cards.length} cards`}
      action={
        category ? (
          <Button
            title={settingsOpen ? 'Done' : 'Settings'}
            variant="ghost"
            size="compact"
            onPress={() => setSettingsOpen((open) => !open)}
          />
        ) : undefined
      }
    >
      <Panel tint>
        <View style={s.between}>
          <Text style={[s.metric, { fontSize: 54 }]}>{paused ? 'Ⅱ' : summary.due.length}</Text>
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={s.sectionTitle}>{paused ? 'Reviews paused' : 'Cards due'}</Text>
            <Text style={s.caption}>
              {data.reviewSettings?.reviewEnabled === false
                ? 'Global review rules are paused.'
                : category?.reviewEnabled === false
                  ? 'This category is out of your scheduled queue.'
                  : summary.nextDue
                    ? 'Next scheduled card: ' + new Date(summary.nextDue).toLocaleDateString()
                    : summary.cards.length
                      ? 'Your next cards will appear here when due.'
                      : 'Add a deck to start.'}
            </Text>
          </View>
        </View>
        <Button
          title={'Review ' + summary.due.length + ' due'}
          disabled={paused || !summary.due.length}
          onPress={() => review(false)}
        />
        {!!summary.cards.length && (
          <Button title="Practice all cards" variant="secondary" onPress={() => review(true)} />
        )}
        <Text style={s.caption}>
          Practice is always available. Your responses set each card’s next review date.
        </Text>
      </Panel>
      {settingsOpen && category && (
        <CategorySettings
          key={category.id}
          categoryId={category.id}
          complete={() => setSettingsOpen(false)}
        />
      )}
      <View style={s.between}>
        <Text style={[s.sectionTitle, { flex: 1 }]}>Decks in this category</Text>
        {!uncategorized && (
          <Button
            title={assignOpen ? 'Done' : '+ Add decks'}
            size="compact"
            variant="ghost"
            onPress={() => setAssignOpen((open) => !open)}
          />
        )}
      </View>
      {!uncategorized && (
        <Button
          title="Create a deck here"
          variant="secondary"
          size="compact"
          onPress={() => router.push({ pathname: '/decks/new', params: { categoryId: id } })}
        />
      )}
      {assignOpen && (
        <Panel>
          <Text style={s.sectionTitle}>Add existing decks</Text>
          <Text style={s.caption}>
            Each deck belongs to one category. Adding it here moves it from its current category.
          </Text>
          <Field
            label="Find a deck"
            value={search}
            onChangeText={setSearch}
            placeholder="Deck name"
          />
          {available.map((deck) => (
            <Button
              key={deck.id}
              title={'+ ' + deck.name}
              variant="secondary"
              size="compact"
              disabled={busy}
              onPress={() => void run((repo) => repo.setDeckCategory(deck.id, id))}
            />
          ))}
          {!available.length && (
            <Text style={s.caption}>No other decks match. Create a new deck above.</Text>
          )}
        </Panel>
      )}
      {summary.decks.map((deck) => (
        <Panel key={deck.id} style={{ borderLeftColor: deck.color, borderLeftWidth: 4 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={'Open ' + deck.name}
            onPress={() => router.push({ pathname: '/decks/[id]', params: { id: deck.id } })}
          >
            <View style={s.row}>
              <DeckArtwork
                id={deck.id}
                color={deck.color}
                icon={deck.icon}
                imageDataUrl={deck.imageDataUrl}
                size={48}
              />
              <View style={{ flex: 1, gap: 5 }}>
                <Text style={s.sectionTitle}>{deck.name}</Text>
                <Text style={s.caption}>
                  {summary.cards.filter((card) => card.deckId === deck.id).length} cards ·{' '}
                  {summary.due.filter((card) => card.deckId === deck.id).length} due
                </Text>
              </View>
              <Text style={s.body}>→</Text>
            </View>
          </Pressable>
          {!uncategorized && (
            <Button
              title="Move to Uncategorized"
              variant="ghost"
              size="compact"
              disabled={busy}
              onPress={() => void run((repo) => repo.setDeckCategory(deck.id, null))}
            />
          )}
        </Panel>
      ))}
      {!summary.decks.length && (
        <Text style={s.body}>No decks here yet. Your category is ready for its first subject.</Text>
      )}
    </Screen>
  );
}

function CategorySettings({ categoryId, complete }: { categoryId: string; complete(): void }) {
  const { data, repository, mutate } = useStore();
  const actionScope = useActionScope(repository?.ownerId);
  const [baseline] = useState(data.reviewSettings);
  const current = data.reviewSettings?.categories.find((category) => category.id === categoryId);
  const [formOwner] = useState(repository?.ownerId);
  const [name, setName] = useState(current?.name ?? '');
  const [enabled, setEnabled] = useState(current?.reviewEnabled ?? true);
  const [inherit, setInherit] = useState(!current?.cadence);
  const [draft, setDraft] = useState(() =>
    cadenceDraft(current?.cadence ?? data.reviewSettings?.cadence),
  );
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const parsed = parseCadence(draft);
  async function save() {
    const live = actionScope();
    if (!live() || !current || !name.trim() || (!inherit && !parsed) || saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      await mutate(async (repo) => {
        if (!live() || repo.ownerId !== formOwner)
          throw new Error('The signed-in account changed. Reopen this category.');
        const latest = (await repo.snapshot()).reviewSettings;
        if (!live()) return;
        if (
          !baseline ||
          !latest ||
          JSON.stringify(settingsInput(latest, repo.ownerId)) !==
            JSON.stringify(settingsInput(baseline, repo.ownerId))
        )
          throw new Error(
            'Your categories changed while these settings were open. Close and reopen them before saving.',
          );
        const { id, reviewEnabled, cadence, deckCategories } = baseline;
        return repo.saveReviewSettings(
          {
            id,
            reviewEnabled,
            cadence,
            deckCategories,
            categories: baseline.categories.map((category) =>
              category.id === categoryId
                ? {
                    ...category,
                    name: name.trim(),
                    reviewEnabled: enabled,
                    cadence: inherit ? null : parsed,
                  }
                : category,
            ),
          },
          latest,
        );
      });
      if (live()) complete();
    } catch (error) {
      if (live()) reportError(error);
    } finally {
      if (live()) {
        saving.current = false;
        setBusy(false);
      }
    }
  }
  function remove() {
    const live = actionScope();
    if (!live() || saving.current) return;
    Alert.alert(
      'Remove this category?',
      'Its decks move to Uncategorized and follow your global review rules. Cards and review history stay in your library.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove category',
          style: 'destructive',
          onPress: () => {
            if (!live() || saving.current) return;
            saving.current = true;
            setBusy(true);
            void mutate((repo) => {
              if (!live() || repo.ownerId !== formOwner)
                throw new Error('The signed-in account changed.');
              return repo.removeCategory(categoryId);
            })
              .then(() => {
                if (live()) router.dismissTo('/categories');
              })
              .catch((error) => {
                if (live()) reportError(error);
              })
              .finally(() => {
                if (live()) {
                  saving.current = false;
                  setBusy(false);
                }
              });
          },
        },
      ],
    );
  }
  return (
    <Panel>
      <Text style={s.sectionTitle}>Category rules</Text>
      <Field
        label="Category name"
        value={name}
        maxLength={100}
        editable={!busy}
        onChangeText={setName}
      />
      <ReviewToggle
        title="Include in scheduled reviews"
        value={enabled}
        disabled={busy}
        onChange={setEnabled}
        detail="Turn off to pause this category. Its decks and practice history stay put."
      />
      <ReviewToggle
        title="Use global spacing"
        value={inherit}
        disabled={busy}
        onChange={setInherit}
        detail="Follow your default cadence, including future changes to it."
      />
      {inherit ? (
        <Button
          title="View global review rules →"
          variant="ghost"
          onPress={() => router.push('/review-settings')}
        />
      ) : (
        <CadenceEditor value={draft} onChange={setDraft} disabled={busy} />
      )}
      {!inherit && !parsed && (
        <Text accessibilityRole="alert" style={{ color: colors.danger }}>
          Check the spacing: use whole days in increasing order.
        </Text>
      )}
      <Button
        title="Save category rules"
        disabled={busy || !name.trim() || (!inherit && !parsed)}
        loading={busy}
        onPress={() => void save()}
      />
      <Button
        title="Remove category"
        variant="danger"
        size="compact"
        disabled={busy}
        onPress={remove}
      />
    </Panel>
  );
}
