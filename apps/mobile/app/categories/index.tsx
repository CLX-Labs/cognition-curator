import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useStore } from '../../src/store';
import { categorySummary } from '../../src/category-model';
import { CategoryReviewRows } from '../../src/review-settings-ui';
import { Back, Button, Field, Panel, Screen, Text, colors, reportError, s } from '../../src/ui';
import { BrandPattern } from '../../src/brand-patterns';
import { useActionScope } from '../../src/use-action-scope';

export default function Categories() {
  const { repository, data, mutate } = useStore();
  const actionScope = useActionScope(repository?.ownerId);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const uncategorized = categorySummary(data, null);
  async function create() {
    const live = actionScope();
    if (!live() || !repository || !name.trim() || saving.current) return;
    const owner = repository.ownerId;
    const id = repository.newId();
    saving.current = true;
    setBusy(true);
    try {
      await mutate((repo) => {
        if (!live() || repo.ownerId !== owner) throw new Error('The signed-in account changed.');
        return repo.saveCategory({
          id,
          name: name.trim(),
          color: colors.lilac,
          reviewEnabled: true,
          cadence: null,
        });
      });
      if (!live()) return;
      setName('');
      router.push({ pathname: '/categories/[id]', params: { id } });
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
    <Screen
      title="Room for everything."
      eyebrow="YOUR CATEGORIES"
      leading={<Back label="Decks" />}
      subtitle="Group your decks. Set the pace for each part of your curiosity."
      action={<BrandPattern variant="weave" width={64} height={64} />}
    >
      <Panel tint>
        <Text style={s.sectionTitle}>One library. Your rhythm.</Text>
        <Text style={s.body}>
          Set review rules for everything, then let each category follow along or find its own pace.
        </Text>
        <Button
          title="Global review rules →"
          variant="secondary"
          onPress={() => router.push('/review-settings')}
        />
      </Panel>
      <CategoryReviewRows />
      <Panel>
        <Text style={s.sectionTitle}>New category</Text>
        <Field
          label="Category name"
          placeholder="Jeopardy trivia"
          maxLength={100}
          value={name}
          onChangeText={setName}
          editable={!busy}
        />
        <Button
          title="Create category"
          disabled={!name.trim() || busy}
          loading={busy}
          onPress={() => void create()}
        />
      </Panel>
      <Panel>
        <View style={s.between}>
          <Text style={[s.sectionTitle, { flex: 1 }]}>Uncategorized</Text>
          <Text style={s.label}>{uncategorized.decks.length} decks</Text>
        </View>
        <Text style={s.body}>
          These decks follow your global review rules. Add them to a category whenever you’re ready.
        </Text>
        <Button
          title="View uncategorized decks →"
          variant="ghost"
          onPress={() =>
            router.push({ pathname: '/categories/[id]', params: { id: 'uncategorized' } })
          }
        />
      </Panel>
    </Screen>
  );
}
