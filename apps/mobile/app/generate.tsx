import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { generationRequestSchema, type GenerationCandidate } from '@recollect/contracts';
import { useStore } from '../src/store';
import {
  acceptGeneration,
  fetchGeneration,
  GENERATION_KEY,
  type GenerationWorkflow,
} from '../src/generation';
import { Back, Button, Field, Panel, Screen, colors, reportError, s } from '../src/ui';

export default function GenerateScreen() {
  const params = useLocalSearchParams<{ deckId?: string }>();
  const { repository, data, sync, refresh } = useStore();
  const [deckId, setDeckId] = useState(params.deckId ?? data.decks[0]?.id ?? '');
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(5);
  const [state, setState] = useState<GenerationWorkflow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<GenerationWorkflow | null>(null);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
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
    if (!repository || !current.current) return;
    setBusy(true);
    setError(null);
    try {
      await writes.current;
      const next = await fetchGeneration(repository, current.current);
      if (mounted.current) {
        current.current = next;
        setState(next);
      }
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error ? cause.message : 'Connection interrupted. Your request is saved.',
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [repository]);
  useEffect(() => {
    if (!state?.job || !['queued', 'running'].includes(state.job.status) || busy || error) return;
    const timer = setTimeout(() => {
      void resume();
    }, 2500);
    return () => clearTimeout(timer);
  }, [state, busy, error, resume]);

  async function create() {
    if (!repository) return;
    setBusy(true);
    setError(null);
    try {
      await sync();
      const local = await repository.snapshot();
      const deck = local.decks.find((d) => d.id === deckId);
      if (
        !deck ||
        deck.version < 1 ||
        local.issues.some(
          (issue) =>
            issue.operation.type.startsWith('deck.') &&
            'id' in issue.operation.payload &&
            issue.operation.payload.id === deckId,
        )
      ) {
        throw new Error(
          'Synchronize this deck before generating cards. Your manual cards remain available offline.',
        );
      }
      const request = generationRequestSchema.parse({
        operationId: repository.newId(),
        deckId,
        prompt: prompt.trim(),
        count,
      });
      const pending: GenerationWorkflow = {
        request,
        job: null,
        drafts: {},
        selectedIds: [],
        acceptance: null,
        accepted: false,
      };
      await repository.setState(GENERATION_KEY, pending);
      current.current = pending;
      setState(pending);
      const next = await fetchGeneration(repository, pending);
      current.current = next;
      setState(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The request could not be started.');
    } finally {
      setBusy(false);
    }
  }
  async function accept() {
    if (!repository || !current.current) return;
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
      setBusy(false);
    }
  }
  async function startAgain() {
    if (!repository || !state) return;
    await writes.current;
    await repository.archive({ generation: state });
    await repository.setState(GENERATION_KEY, null);
    current.current = null;
    setState(null);
    setError(null);
    setPrompt('');
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
    <Screen title="A spark for your next idea." eyebrow="CREATE WITH AI" tabs={false}>
      <Back />
      <Text style={s.body}>
        Turn a topic or your notes into a small set of cards. Read each draft, correct it, and
        choose what belongs in your library.
      </Text>
      {!loaded && <ActivityIndicator color={colors.accent} />}
      {error && (
        <Panel>
          <Text style={{ color: colors.danger, lineHeight: 21 }}>{error}</Text>
          {state && (
            <Button
              title={
                state.acceptance ? 'Retry saving the same selection' : 'Retry the saved request'
              }
              onPress={() => void (state.acceptance ? accept() : resume())}
              disabled={busy}
            />
          )}
        </Panel>
      )}
      {loaded && !state && (
        <>
          <Text style={s.label}>Save cards to</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {data.decks.map((deck) => (
              <Pressable
                key={deck.id}
                onPress={() => setDeckId(deck.id)}
                accessibilityRole="radio"
                accessibilityState={{ checked: deckId === deck.id }}
                style={[
                  s.pill,
                  { backgroundColor: deckId === deck.id ? colors.green : '#EAEDE5', padding: 12 },
                ]}
              >
                <Text style={{ color: colors.ink, fontWeight: '600' }}>
                  {deck.icon} {deck.name}
                </Text>
              </Pressable>
            ))}
          </View>
          {!data.decks.length && (
            <Button title="Create your first deck" onPress={() => router.push('/decks/new')} />
          )}
          <Field
            label="What would you like to remember?"
            multiline
            value={prompt}
            onChangeText={setPrompt}
            placeholder="Paste your notes, or try: The main ideas in cellular respiration, for a first-year biology course."
            style={{ minHeight: 180 }}
            maxLength={20000}
          />
          <View style={s.between}>
            <Text style={s.label}>Number of cards</Text>
            <View style={s.row}>
              {[3, 5, 10, 20].map((value) => (
                <Pressable
                  key={value}
                  onPress={() => setCount(value)}
                  style={[s.pill, { backgroundColor: count === value ? colors.green : '#EAEDE5' }]}
                >
                  <Text style={s.label}>{value}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <Button
            title={'Draft ' + count + ' cards'}
            loading={busy}
            disabled={!deckId || prompt.trim().length < 10}
            onPress={() => void create()}
          />
          <Text style={s.caption}>
            Your prompt is sent to the generation service. AI can make mistakes; these cards enter
            your library only after you approve them.
          </Text>
        </>
      )}
      {state && (
        <>
          <Panel tint>
            <Text style={s.label}>
              {data.decks.find((d) => d.id === state.request.deckId)?.name ?? 'Your deck'}
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
                  Your request survives closing the app. Return here to pick up where you left off.
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
          {state.job?.status === 'succeeded' && !state.acceptance && !state.accepted && (
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
