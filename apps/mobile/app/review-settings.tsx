import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useStore } from '../src/store';
import { cadenceDraft, parseCadence, settingsInput } from '../src/category-model';
import { CadenceEditor, ReviewToggle } from '../src/review-settings-ui';
import { Back, Button, Panel, Screen, Text, colors, reportError, s } from '../src/ui';
import { useActionScope } from '../src/use-action-scope';

export default function ReviewSettingsScreen() {
  const { repository, data, mutate } = useStore();
  const actionScope = useActionScope(repository?.ownerId);
  const [formOwner] = useState(repository?.ownerId);
  const [baseline] = useState(data.reviewSettings);
  const [enabled, setEnabled] = useState(data.reviewSettings?.reviewEnabled ?? true);
  const [draft, setDraft] = useState(() => cadenceDraft(data.reviewSettings?.cadence));
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const parsed = parseCadence(draft);
  async function save() {
    const live = actionScope();
    if (!live() || !parsed || saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      await mutate(async (repo) => {
        if (!live() || repo.ownerId !== formOwner)
          throw new Error('The signed-in account changed. Reopen these settings.');
        const latest = (await repo.snapshot()).reviewSettings;
        if (!live()) return;
        if (
          JSON.stringify(settingsInput(latest, repo.ownerId)) !==
          JSON.stringify(settingsInput(baseline, repo.ownerId))
        )
          throw new Error(
            'Your review rules changed while this page was open. Go back and reopen them before saving.',
          );
        await repo.saveReviewSettings(
          { ...settingsInput(baseline, repo.ownerId), reviewEnabled: enabled, cadence: parsed },
          latest ?? undefined,
        );
      });
      if (live()) router.back();
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
      title="Your review rules"
      eyebrow="REVIEW / DEFAULTS"
      leading={<Back />}
      subtitle="One rhythm for your library. Give a category its own spacing whenever you like."
    >
      <Panel>
        <ReviewToggle
          title="Scheduled reviews"
          value={enabled}
          onChange={setEnabled}
          disabled={busy}
          detail="Turn off to pause the due queue across all categories and uncategorized decks. Practice stays available."
        />
      </Panel>
      <Panel>
        <Text style={s.sectionTitle}>Default spacing</Text>
        <CadenceEditor value={draft} onChange={setDraft} disabled={busy} />
      </Panel>
      {!parsed && (
        <Text accessibilityRole="alert" style={{ color: colors.danger }}>
          Check the spacing: use whole days in increasing order.
        </Text>
      )}
      <View style={{ gap: 12 }}>
        <Button
          title="Save review rules"
          onPress={() => void save()}
          disabled={!parsed || busy}
          loading={busy}
        />
        <Text style={s.caption}>
          Category overrides keep their own spacing. Global pause always takes priority.
        </Text>
      </View>
    </Screen>
  );
}
