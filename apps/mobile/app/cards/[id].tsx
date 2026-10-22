import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useStore } from '../../src/store';
import AnswerGenerator from '../../src/answer-generator';
import { saveCardDraft } from '../../src/card-draft';
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
  Text,
} from '../../src/ui';

export default function CardEditor() {
  const { id, deckId } = useLocalSearchParams<{ id: string; deckId?: string }>();
  const { data, repository, mutate } = useStore();
  const existing = data.cards.find((card) => card.id === id);
  const [baseline] = useState(existing);
  const [draftCardId, setDraftCardId] = useState(() => existing?.id ?? repository?.newId() ?? '');
  const [answerDraftId, setAnswerDraftId] = useState(existing?.id ?? 'new');
  const [front, setFront] = useState(existing?.front ?? '');
  const [back, setBack] = useState(existing?.back ?? '');
  const [hint, setHint] = useState(existing?.hint ?? '');
  const [explanation, setExplanation] = useState(existing?.explanation ?? '');
  const [tags, setTags] = useState(existing?.tags.join(', ') ?? '');
  const [busy, setBusy] = useState(false);
  const [answerPending, setAnswerPending] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [aiGenerated, setAiGenerated] = useState(existing?.aiGenerated ?? false);
  const scrollRef = useRef<ScrollView>(null);
  const questionRef = useRef<TextInput>(null);
  const saving = useRef(false);
  const focusNext = useRef(false);
  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    scrollRef.current?.scrollTo({ y: 0, animated: true });
    questionRef.current?.focus();
  }, [draftCardId]);
  const parentId = baseline?.deckId ?? deckId;
  const parent = data.decks.find((deck) => deck.id === parentId);
  const ready = !!front.trim() && !!back.trim() && !!parent && !answerPending;
  const hasChanges =
    front !== (baseline?.front ?? '') ||
    back !== (baseline?.back ?? '') ||
    hint !== (baseline?.hint ?? '') ||
    explanation !== (baseline?.explanation ?? '') ||
    tags !== (baseline?.tags.join(', ') ?? '') ||
    aiGenerated !== (baseline?.aiGenerated ?? false);
  function confirmExit() {
    if (busy) return;
    const exit = () => router.dismissTo({ pathname: '/decks/[id]', params: { id: parentId! } });
    if (!hasChanges) return exit();
    Alert.alert(
      'Discard unsaved edits?',
      'Your saved cards and answer requests will remain available.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard edits', style: 'destructive', onPress: exit },
      ],
    );
  }
  async function save(addAnother = false) {
    if (!parentId || !repository || !ready || saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      await mutate((repo) =>
        saveCardDraft(
          repo,
          {
            id: draftCardId,
            deckId: parentId,
            front: front.trim(),
            back: back.trim(),
            hint,
            explanation,
            tags: tags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
            aiGenerated,
          },
          baseline,
          answerDraftId,
        ),
      );
      if (addAnother) {
        focusNext.current = true;
        const nextId = repository.newId();
        setDraftCardId(nextId);
        setAnswerDraftId(nextId);
        setFront('');
        setBack('');
        setHint('');
        setExplanation('');
        setTags('');
        setAiGenerated(false);
        setAnswerPending(false);
        setDetailsOpen(false);
        setSavedNotice('Card saved to ' + parent!.name + '. Ready for the next one.');
      } else router.dismissTo({ pathname: '/decks/[id]', params: { id: parentId } });
    } catch (error) {
      reportError(error);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  if (id !== 'new' && !existing)
    return (
      <Screen leading={<Back />}>
        <Empty
          title="This card is unavailable"
          detail="It may have been removed on another device."
        />
      </Screen>
    );
  if (!parent)
    return (
      <Screen leading={<Back />}>
        <Empty
          title="Choose a deck first"
          detail="Open a deck from your library to add a card."
          action={<Button title="Open decks" onPress={() => router.dismissTo('/decks')} />}
        />
      </Screen>
    );
  return (
    <Screen
      title={existing ? 'Edit card' : 'Add a card'}
      eyebrow="CARD"
      subtitle={'In ' + parent.name}
      leading={<Back label="Deck" onPress={confirmExit} />}
      scrollRef={scrollRef}
      footer={
        <View style={{ gap: 8 }}>
          {answerPending && (
            <Text style={s.caption}>
              Wait for the answer or use Set aside in the answer draft to save your own.
            </Text>
          )}
          {!existing && (
            <Button
              title="Save & add another"
              disabled={!ready}
              loading={busy}
              onPress={() => void save(true)}
            />
          )}
          <Button
            title={existing ? 'Save changes' : 'Save card'}
            variant={existing ? 'primary' : 'secondary'}
            size={!existing ? 'compact' : 'normal'}
            disabled={!ready || busy}
            loading={existing && busy}
            onPress={() => void save()}
          />
        </View>
      }
    >
      {savedNotice && (
        <View
          accessibilityLiveRegion="polite"
          style={{ backgroundColor: colors.yellow, padding: 12, borderRadius: 12 }}
        >
          <Text style={s.caption}>{savedNotice}</Text>
        </View>
      )}
      <Field
        label={baseline?.aiGenerated ? 'Title' : 'Question'}
        placeholder="What do you want to remember?"
        value={front}
        multiline
        maxLength={20000}
        inputRef={questionRef}
        editable={!busy}
        onChangeText={(value) => {
          setFront(value);
          setSavedNotice(null);
        }}
      />
      <Field
        label="Answer"
        placeholder="Write an answer or generate one below"
        value={back}
        multiline
        maxLength={30000}
        editable={!busy}
        onChangeText={setBack}
      />
      <AnswerGenerator
        cardId={answerDraftId}
        deckId={parentId!}
        question={front}
        onPendingChange={setAnswerPending}
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
      <Panel style={{ padding: 18 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: detailsOpen }}
          accessibilityLabel="Card details"
          style={[s.between, { minHeight: 44 }]}
          onPress={() => setDetailsOpen((open) => !open)}
        >
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.label}>More details</Text>
            <Text style={s.caption}>Optional hint, explanation and tags</Text>
          </View>
          <Text style={{ color: colors.muted, fontSize: 19 }}>{detailsOpen ? '−' : '+'}</Text>
        </Pressable>
        {detailsOpen && (
          <>
            <Field
              label="Hint"
              value={hint}
              maxLength={10000}
              editable={!busy}
              onChangeText={setHint}
            />
            <Field
              label="Explanation"
              value={explanation}
              multiline
              maxLength={30000}
              editable={!busy}
              onChangeText={setExplanation}
            />
            <Field
              label="Tags"
              hint="Separate tags with commas."
              value={tags}
              editable={!busy}
              onChangeText={setTags}
            />
            {existing && (
              <Button
                title="Delete card"
                variant="danger"
                size="compact"
                disabled={busy}
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
                            .then(() =>
                              router.dismissTo({
                                pathname: '/decks/[id]',
                                params: { id: parentId! },
                              }),
                            )
                            .catch(reportError),
                      },
                    ],
                  )
                }
              />
            )}
          </>
        )}
      </Panel>
    </Screen>
  );
}
