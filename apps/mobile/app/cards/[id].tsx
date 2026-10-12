import React, { useState } from 'react';
import { Alert, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useStore } from '../../src/store';
import AnswerGenerator from '../../src/answer-generator';
import { Back, Button, Field, Screen, reportError, s } from '../../src/ui';
export default function CardEditor() {
  const { id, deckId } = useLocalSearchParams<{ id: string; deckId?: string }>();
  const { data, repository, mutate } = useStore();
  const existing = data.cards.find((c) => c.id === id);
  const [baseline] = useState(existing);
  const [front, setFront] = useState(existing?.front ?? '');
  const [back, setBack] = useState(existing?.back ?? '');
  const [hint, setHint] = useState(existing?.hint ?? '');
  const [explanation, setExplanation] = useState(existing?.explanation ?? '');
  const [tags, setTags] = useState(existing?.tags.join(', ') ?? '');
  const [busy, setBusy] = useState(false);
  const [aiGenerated, setAiGenerated] = useState(existing?.aiGenerated ?? false);
  const parentId = baseline?.deckId ?? deckId;
  async function save() {
    if (!parentId) return;
    setBusy(true);
    try {
      await mutate((repo) =>
        repo.saveCard(
          {
            id: existing?.id ?? repository!.newId(),
            deckId: parentId,
            front: front.trim(),
            back: back.trim(),
            hint,
            explanation,
            tags: tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
            aiGenerated,
          },
          baseline,
        ),
      );
      router.dismissTo({ pathname: '/decks/[id]', params: { id: parentId } });
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  }
  if (id !== 'new' && !existing)
    return (
      <Screen>
        <Back />
        <Text style={s.body}>This card is no longer available.</Text>
      </Screen>
    );
  return (
    <Screen
      title={existing ? 'Make it stick.' : 'A new card.'}
      eyebrow={existing ? 'EDIT CARD' : 'QUESTION + ANSWER'}
    >
      <Back />
      <Field
        label="Question"
        placeholder="What do you want to remember?"
        value={front}
        multiline
        maxLength={20000}
        onChangeText={setFront}
      />
      <Field
        label="Answer"
        placeholder="The clear, concise answer"
        value={back}
        multiline
        maxLength={30000}
        onChangeText={setBack}
      />
      {parentId && (
        <AnswerGenerator
          cardId={id}
          deckId={parentId}
          question={front}
          onRestoreQuestion={setFront}
          onUse={(answer) => {
            const apply = () => {
              setBack(answer);
              setAiGenerated(true);
            };
            if (back.trim() && back !== answer)
              Alert.alert(
                'Replace your answer?',
                'Your current answer will be replaced with this draft. You can edit it before saving.',
                [
                  { text: 'Keep mine', style: 'cancel' },
                  { text: 'Use draft', onPress: apply },
                ],
              );
            else apply();
          }}
        />
      )}
      <Field label="Hint (optional)" value={hint} maxLength={10000} onChangeText={setHint} />
      <Field
        label="Explanation (optional)"
        value={explanation}
        multiline
        maxLength={30000}
        onChangeText={setExplanation}
      />
      <Field label="Tags (comma separated)" value={tags} onChangeText={setTags} />
      <Button
        title="Save card"
        disabled={!front.trim() || !back.trim() || !parentId}
        loading={busy}
        onPress={() => void save()}
      />
      {existing && (
        <Button
          title="Delete card"
          variant="danger"
          onPress={() =>
            Alert.alert(
              'Delete this card?',
              'The card will be removed from your active library.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () =>
                    void mutate((repo) =>
                      repo.remove('card', existing.id, baseline ?? existing),
                    )
                      .then(() => router.back())
                      .catch(reportError),
                },
              ],
            )
          }
        />
      )}
    </Screen>
  );
}
