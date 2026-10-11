import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { generationRequestSchema, type GenerationCandidate } from '@recollect/contracts';
import { useStore } from '../src/store';
import {
  acceptGeneration,
  fetchGeneration,
  prepareGeneration,
  GENERATION_KEY,
  type GenerationWorkflow,
} from '../src/generation';
import { Back, Button, Field, Panel, Screen, colors, reportError, s } from '../src/ui';

export default function GenerateScreen() {
  const params = useLocalSearchParams<{ deckId?: string }>();
  const { repository, data, sync, refresh } = useStore();
  const [deckId, setDeckId] = useState(params.deckId ?? '');
  const [newDeck, setNewDeck] = useState(!params.deckId);
  const [prompt, setPrompt] = useState(
    data.decks.find((d) => d.id === params.deckId)?.name ?? '',
  );
  const [count, setCount] = useState(5);
  const [state, setState] = useState<GenerationWorkflow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<GenerationWorkflow | null>(null);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const update = useCallback(
    (next: GenerationWorkflow) => {
      current.current = next;
      setState(next);
      const repo = repository;
      if (repo) {
        writes.current = writes.current
          .catch(() => undefined)
          .then(() => repo.setState(GENERATION_KEY, next));
        void writes.current.catch((cause) => {
          if (mounted.current)
            setError(
              cause instanceof Error
                ? cause.message
                : 'The draft could not be saved on this device.',
            );
        });
      }
    },
    [repository],
  );
  useEffect(() => {
    mounted.current = true;
    let active = true;
    if (repository)
      void repository
        .getState<GenerationWorkflow>(GENERATION_KEY)
        .then((saved) => {
          if (!active) return;
          current.current = saved;
          setState(saved);
          if (saved) setDeckId(saved.request.deckId);
          setLoaded(true);
        })
        .catch(reportError);
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [repository]);
  const resume = useCallback(async () => {
    if (!repository || !current.current || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await writes.current;
      if (!current.current.job) {
        await prepareGeneration(repository, current.current, sync);
        await refresh();
      }
      const next = await fetchGeneration(repository, current.current);
      if (mounted.current) {
        current.current = next;
        setState(next);
      }
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Connection interrupted. Your request is saved.',
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [repository, sync, refresh]);
  useEffect(() => {
    if (!state?.job || !['queued', 'running'].includes(state.job.status) || busy || error)
      return;
    const timer = setTimeout(() => {
      void resume();
    }, 2500);
    return () => clearTimeout(timer);
  }, [state, busy, error, resume]);

  async function create() {
    if (!repository || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const destinationId = newDeck ? repository.newId() : deckId;
      const request = generationRequestSchema.parse({
        operationId: repository.newId(),
        deckId: destinationId,
        prompt: prompt.trim(),
        count,
      });
      const pending: GenerationWorkflow = {
        request,
        ...(newDeck
          ? {
              newDeck: {
                id: destinationId,
                name: prompt.trim().slice(0, 200),
                description: '',
                color: '#DDE8D9',
                icon: '📚',
                isSilenced: false,
                silencedUntil: null,
              },
            }
          : {}),
        job: null,
        drafts: {},
        selectedIds: [],
        acceptance: null,
        accepted: false,
      };
      await repository.setState(GENERATION_KEY, pending);
      current.current = pending;
      setState(pending);
      await prepareGeneration(repository, pending, sync);
      await refresh();
      const next = await fetchGeneration(repository, pending);
      current.current = next;
      setState(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The request could not be started.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function accept() {
    if (!repository || !current.current || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await writes.current;
      const before = current.current;
      for (const id of before.selectedIds) {
        const candidate = before.drafts[id];
        if (!candidate?.front.trim() || !candidate.back.trim())
          throw new Error('Every selected card needs a question and an answer.');
      }
      const pending = before.acceptance
        ? before
        : {
            ...before,
            acceptance: {
              operationId: repository.newId(),
              candidateIds: before.selectedIds,
              edits: before.drafts,
            },
          };
      current.current = pending;
      setState(pending);
      const complete = await acceptGeneration(repository, pending);
      current.current = complete;
      setState(complete);
      await refresh();
      void sync();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Your selection is saved. Retry to finish.',
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function startAgain() {
    if (!repository || !state || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await writes.current;
      await repository.archive({ generation: state });
      await repository.setState(GENERATION_KEY, null);
      current.current = null;
      setState(null);
      setError(null);
      setPrompt('');
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function edit(
    candidate: GenerationCandidate,
    field: 'front' | 'back' | 'hint' | 'explanation',
    value: string,
  ) {
    if (!current.current || current.current.acceptance) return;
    update({
      ...current.current,
      drafts: { ...current.current.drafts, [candidate.id]: { ...candidate, [field]: value } },
    });
  }
  return (
    <Screen title="What are you learning?" eyebrow="CREATE CARDS & DECKS">
      {params.deckId && <Back />}
      <Text style={s.body}>
        Enter a subject or deck title to generate 5–10 cards. Review the questions and answers,
        then save them to your deck.
      </Text>
      {!loaded && <ActivityIndicator color={colors.accent} />}
      {error && (
        <Panel>
          <Text style={{ color: colors.danger, lineHeight: 21 }}>{error}</Text>
          {state && (
            <Button
              title={
                state.acceptance
                  ? 'Retry saving the same selection'
                  : 'Retry the saved request'
              }
              onPress={() => void (state.acceptance ? accept() : resume())}
              disabled={busy}
            />
          )}
        </Panel>
      )}
      {loaded && !state && (
        <>
          <View style={s.row}>
            <Button
              title="New deck"
              variant={newDeck ? 'primary' : 'secondary'}
              disabled={busy}
              onPress={() => setNewDeck(true)}
            />
            <Button
              title="Existing deck"
              variant={!newDeck ? 'primary' : 'secondary'}
              disabled={busy || !data.decks.length}
              onPress={() => {
                setNewDeck(false);
                if (!deckId) setDeckId(data.decks[0]!.id);
              }}
            />
          </View>
          {!newDeck && <Text style={s.label}>Save cards to</Text>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {!newDeck &&
              data.decks.map((deck) => (
                <Pressable
                  key={deck.id}
                  disabled={busy}
                  onPress={() => {
                    setDeckId(deck.id);
                    setPrompt(deck.name);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: deckId === deck.id }}
                  style={[
                    s.pill,
                    {
                      backgroundColor: deckId === deck.id ? colors.green : '#EAEDE5',
                      padding: 12,
                    },
                  ]}
                >
                  <Text style={{ color: colors.ink, fontWeight: '600' }}>
                    {deck.icon} {deck.name}
                  </Text>
                </Pressable>
              ))}
          </View>
          <Field
            label={newDeck ? 'Subject or deck title' : 'Subject'}
            multiline
            value={prompt}
            editable={!busy}
            onChangeText={setPrompt}
            placeholder={
              newDeck
                ? 'e.g. Biology, French verbs, World history'
                : (data.decks.find((d) => d.id === deckId)?.name ??
                  'What should these cards cover?')
            }
            style={{ minHeight: 104 }}
            maxLength={newDeck ? 200 : 20000}
          />
          <View style={{ gap: 10 }}>
            <Text style={s.label}>Number of cards</Text>
            <View style={[s.row, { flexWrap: 'wrap' }]}>
              {[5, 6, 7, 8, 9, 10].map((value) => (
                <Pressable
                  key={value}
                  disabled={busy}
                  onPress={() => setCount(value)}
                  accessibilityRole="radio"
                  accessibilityLabel={value + ' cards'}
                  accessibilityState={{ checked: count === value }}
                  style={[
                    s.pill,
                    { backgroundColor: count === value ? colors.green : '#EAEDE5' },
                  ]}
                >
                  <Text style={s.label}>{value}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <Button
            title={
              newDeck
                ? 'Generate deck with ' + count + ' cards'
                : 'Generate ' + count + ' cards'
            }
            loading={busy}
            disabled={(!newDeck && !deckId) || !prompt.trim()}
            onPress={() => void create()}
          />
          <Text style={s.caption}>
            Your prompt is sent to the generation service. AI can make mistakes; these cards
            enter your library only after you approve them.
          </Text>
        </>
      )}
      {loaded && !state && (
        <Button
          title="Create a deck manually"
          variant="secondary"
          onPress={() => router.push('/decks/new')}
        />
      )}
      {state && (
        <>
          <Panel tint>
            <Text style={s.label}>
              {data.decks.find((d) => d.id === state.request.deckId)?.name ??
                state.newDeck?.name ??
                'Your deck'}
            </Text>
            <Text style={s.body}>{state.request.prompt}</Text>
            <Text style={s.caption}>
              {state.accepted
                ? 'SAVED TO YOUR LIBRARY'
                : (state.job?.status.toUpperCase() ?? 'REQUEST SAVED ON THIS DEVICE')}
            </Text>
            {(!state.job || ['queued', 'running'].includes(state.job.status)) && (
              <>
                <ActivityIndicator color={colors.ink} />
                <Text style={s.body}>
                  Your request survives closing the app. Return here to pick up where you left
                  off.
                </Text>
                {!state.job && !busy && !error && (
                  <Button title="Resume saved request" onPress={() => void resume()} />
                )}
              </>
            )}
          </Panel>
          {state.job?.status === 'failed' && (
            <Panel>
              <Text style={s.sectionTitle}>The draft could not be completed.</Text>
              <Text style={s.body}>
                {state.job.error?.message ?? 'Please try a different prompt.'}
              </Text>
            </Panel>
          )}
          {state.job?.status === 'succeeded' && !state.accepted && (
            <>
              {state.job.candidates.map((original, index) => {
                const candidate = state.drafts[original.id] ?? original;
                const selected = state.selectedIds.includes(candidate.id);
                const alreadySaved = state.job!.acceptedCandidateIds.includes(candidate.id);
                return (
                  <Panel key={candidate.id}>
                    <Pressable
                      onPress={() =>
                        !state.acceptance &&
                        !alreadySaved &&
                        update({
                          ...state,
                          selectedIds: selected
                            ? state.selectedIds.filter((id) => id !== candidate.id)
                            : [...state.selectedIds, candidate.id],
                        })
                      }
                      accessibilityRole="checkbox"
                      accessibilityState={{
                        checked: selected,
                        disabled: !!state.acceptance || alreadySaved,
                      }}
                      style={s.between}
                    >
                      <Text style={s.label}>
                        {String(index + 1).padStart(2, '0')} ·{' '}
                        {alreadySaved ? 'Already saved' : 'Draft card'}
                      </Text>
                      <Text style={{ color: colors.accent, fontSize: 24 }}>
                        {selected ? '☑' : '□'}
                      </Text>
                    </Pressable>
                    <Field
                      label="Question"
                      multiline
                      value={candidate.front}
                      editable={!state.acceptance && !alreadySaved}
                      onChangeText={(value) => edit(candidate, 'front', value)}
                      maxLength={20000}
                    />
                    <Field
                      label="Answer"
                      multiline
                      value={candidate.back}
                      editable={!state.acceptance && !alreadySaved}
                      onChangeText={(value) => edit(candidate, 'back', value)}
                      maxLength={30000}
                    />
                    <Field
                      label="Hint (optional)"
                      value={candidate.hint}
                      editable={!state.acceptance && !alreadySaved}
                      onChangeText={(value) => edit(candidate, 'hint', value)}
                      maxLength={10000}
                    />
                    <Field
                      label="Explanation (optional)"
                      multiline
                      value={candidate.explanation}
                      editable={!state.acceptance && !alreadySaved}
                      onChangeText={(value) => edit(candidate, 'explanation', value)}
                      maxLength={30000}
                    />
                  </Panel>
                );
              })}
              <Button
                title={
                  'Keep ' +
                  (state.acceptance?.candidateIds.length ?? state.selectedIds.length) +
                  ' cards'
                }
                loading={busy}
                disabled={!state.selectedIds.length}
                onPress={() => void accept()}
              />
              {!!state.acceptance && (
                <Text style={s.caption}>
                  Your selected cards and edits are saved. Retry uses the same request, so a
                  connection interruption cannot create a second set.
                </Text>
              )}
            </>
          )}
          {state.accepted && (
            <>
              <Text style={s.sectionTitle}>Make them part of your practice.</Text>
              <Button
                title="Open this deck"
                onPress={() => router.replace('/decks/' + state.request.deckId)}
              />
            </>
          )}
          {(state.accepted ||
            state.job?.status === 'failed' ||
            state.job?.status === 'canceled') && (
            <Button
              title="Start another set"
              variant="secondary"
              onPress={() => void startAgain().catch(reportError)}
            />
          )}
          {!state.acceptance && !state.accepted && !busy && (
            <Button
              title="Set these drafts aside"
              variant="secondary"
              onPress={() =>
                Alert.alert(
                  'Set these drafts aside?',
                  'A recovery copy stays in your export. These drafts will not be added to your library.',
                  [
                    { text: 'Keep editing', style: 'cancel' },
                    { text: 'Set aside', onPress: () => void startAgain().catch(reportError) },
                  ],
                )
              }
            />
          )}
        </>
      )}
    </Screen>
  );
}
