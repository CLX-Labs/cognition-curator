import React from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { categoryForDeck, type Category } from '@recollect/contracts';
import { useStore } from './store';
import { categorySummary, type CadenceDraft } from './category-model';
import { Button, Field, Panel, Text, colors, reportError, s } from './ui';
import { useActionScope } from './use-action-scope';

export function ReviewToggle({
  title,
  detail,
  value,
  onChange,
  disabled = false,
}: {
  title: string;
  detail?: string;
  value: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={[s.between, { minHeight: 56, gap: 16, paddingVertical: 6 }]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={s.label}>{title}</Text>
        {detail && <Text style={s.caption}>{detail}</Text>}
      </View>
      <View
        style={{
          width: 48,
          height: 28,
          borderRadius: 20,
          padding: 3,
          backgroundColor: value ? colors.accent : colors.line,
          alignItems: value ? 'flex-end' : 'flex-start',
        }}
      >
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.paper }} />
      </View>
    </Pressable>
  );
}
export function CadenceEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: CadenceDraft;
  onChange(value: CadenceDraft): void;
  disabled?: boolean;
}) {
  const fields = [
    ['againDays', 'Not sure'],
    ['hardDays', 'Hard'],
    ['goodDays', 'I remember'],
    ['easyDays', 'Easy'],
    ['maxIntervalDays', 'Longest interval'],
  ] as const;
  return (
    <View style={{ gap: 18 }}>
      <Text style={s.body}>Choose the days before a card returns after each response.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
        {fields.map(([key, label]) => (
          <View key={key} style={{ width: '46%', flexGrow: 1 }}>
            <Field
              label={label + ' · days'}
              value={value[key]}
              keyboardType="number-pad"
              maxLength={4}
              editable={!disabled}
              onChangeText={(text) => onChange({ ...value, [key]: text.replace(/[^0-9]/g, '') })}
            />
          </View>
        ))}
      </View>
      <ReviewToggle
        title="Space out familiar cards"
        value={value.growIntervals}
        disabled={disabled}
        detail="Increase intervals as recall improves, up to your longest interval. Turn off to use the same number of days every time."
        onChange={(growIntervals) => onChange({ ...value, growIntervals })}
      />
      <Text style={s.caption}>
        Use whole days from 1 to 3,650. Keep Not sure ≤ Hard ≤ I remember ≤ Easy ≤ Longest interval.
      </Text>
      <Text style={s.caption}>
        Spacing changes apply after the next review. Cards already scheduled keep their due dates.
      </Text>
    </View>
  );
}
export function CategoryChoices({
  categories,
  selected,
  onSelect,
  disabled = false,
}: {
  categories: Category[];
  selected: string | null;
  onSelect(id: string | null): void;
  disabled?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {[{ id: null, name: 'Uncategorized', color: colors.paper }, ...categories].map((item) => (
        <Pressable
          key={item.id ?? 'uncategorized'}
          accessibilityRole="button"
          accessibilityLabel={item.name}
          accessibilityState={{ selected: selected === item.id, disabled }}
          disabled={disabled}
          onPress={() => onSelect(item.id)}
          style={{
            minHeight: 44,
            borderWidth: 1,
            borderRadius: 12,
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderColor: selected === item.id ? colors.ink : colors.line,
            backgroundColor: selected === item.id ? item.color : colors.paper,
          }}
        >
          <Text style={s.label}>{item.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}
export function CategoryReviewRows({ compact = false }: { compact?: boolean }) {
  const { data } = useStore();
  const categories = data.reviewSettings?.categories ?? [];
  if (compact && !categories.length) return null;
  return (
    <View style={{ gap: 12 }}>
      <View style={s.between}>
        <Text style={[s.sectionTitle, { flex: 1 }]}>Your categories</Text>
        {compact && (
          <Button
            title="Manage →"
            variant="ghost"
            size="compact"
            onPress={() => router.push('/categories')}
          />
        )}
      </View>
      {(compact ? categories.slice(0, 4) : categories).map((category) => {
        const summary = categorySummary(data, category.id);
        const paused = data.reviewSettings?.reviewEnabled === false || !category.reviewEnabled;
        return (
          <Pressable
            key={category.id}
            accessibilityRole="button"
            accessibilityLabel={'Open ' + category.name}
            onPress={() =>
              router.push({ pathname: '/categories/[id]', params: { id: category.id } })
            }
          >
            <Panel style={{ borderLeftWidth: 4, borderLeftColor: category.color, padding: 18 }}>
              <View style={s.between}>
                <View style={{ flex: 1, gap: 5 }}>
                  <Text style={s.sectionTitle}>{category.name}</Text>
                  <Text style={s.caption}>
                    {summary.decks.length} decks · {summary.cards.length} cards
                  </Text>
                  <Text style={[s.caption, { color: paused ? colors.muted : colors.accent }]}>
                    {paused
                      ? 'Scheduled reviews paused'
                      : summary.due.length
                        ? summary.due.length + ' due'
                        : summary.nextDue
                          ? 'Next due ' + new Date(summary.nextDue).toLocaleDateString()
                          : 'No cards due'}
                  </Text>
                </View>
                <Text style={[s.metric, { fontSize: 32 }]}>
                  {paused ? 'Ⅱ' : summary.due.length}
                </Text>
              </View>
            </Panel>
          </Pressable>
        );
      })}
      {!compact && !categories.length && (
        <Text style={s.body}>
          Keep related decks together. Try “Jeopardy trivia” for history, science, and pop culture.
        </Text>
      )}
    </View>
  );
}
export function DeckCategoryLabel({ deckId }: { deckId: string }) {
  const { data } = useStore();
  const category = categoryForDeck(data.reviewSettings, deckId);
  return <Text style={s.caption}>{category?.name ?? 'Uncategorized'}</Text>;
}

export function DeckCategoryPicker({ deckId }: { deckId: string }) {
  return <DeckCategoryPickerSession key={deckId} deckId={deckId} />;
}

function DeckCategoryPickerSession({ deckId }: { deckId: string }) {
  const { data, repository, mutate } = useStore();
  const actionScope = useActionScope(repository?.ownerId);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const saving = React.useRef(false);
  const category = categoryForDeck(data.reviewSettings, deckId);
  async function select(id: string | null) {
    const live = actionScope();
    if (!live() || !repository || saving.current) return;
    saving.current = true;
    setBusy(true);
    const owner = repository.ownerId;
    try {
      await mutate((repo) => {
        if (!live() || repo.ownerId !== owner) throw new Error('The signed-in account changed.');
        return repo.setDeckCategory(deckId, id);
      });
      if (live()) setOpen(false);
    } catch (error) {
      if (live()) reportError(error);
    } finally {
      if (live()) {
        saving.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <Panel style={{ padding: 16 }}>
      <View style={s.between}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={s.eyebrow}>CATEGORY</Text>
          <Text style={s.label}>{category?.name ?? 'Uncategorized'}</Text>
        </View>
        <Button
          title={open ? 'Done' : 'Change'}
          variant="ghost"
          size="compact"
          disabled={busy}
          onPress={() => setOpen((value) => !value)}
        />
      </View>
      {open && (
        <>
          <CategoryChoices
            categories={data.reviewSettings?.categories ?? []}
            selected={category?.id ?? null}
            onSelect={(id) => void select(id)}
            disabled={busy}
          />
          <Button
            title="Create or manage categories →"
            variant="ghost"
            size="compact"
            onPress={() => router.push('/categories')}
          />
        </>
      )}
      {!!category && (
        <Button
          title="Category reviews & spacing →"
          variant="ghost"
          size="compact"
          onPress={() => router.push({ pathname: '/categories/[id]', params: { id: category.id } })}
        />
      )}
    </Panel>
  );
}
