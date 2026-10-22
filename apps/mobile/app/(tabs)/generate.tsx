import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { generationRequestSchema, type GenerationCandidate } from '@recollect/contracts';
import { useStore } from '../../src/store';
import {
  acceptGeneration,
  fetchGeneration,
  generationPrompt,
  prepareGeneration,
  GENERATION_KEY,
  type GenerationWorkflow,
} from '../../src/generation';
import { Back, Button, Field, Panel, Screen, colors, s, Text } from '../../src/ui';
import { useAppActive, usePolling } from '../../src/polling';

export default function GenerateScreen() {
  const focused = useIsFocused();
  const active = useAppActive();
  const params = useLocalSearchParams<{ deckId?: string; fromDeck?: string }>();
  const { repository, data, sync, refresh } = useStore();
  const [deckId, setDeckId] = useState(params.deckId ?? '');
  const [newDeck, setNewDeck] = useState(!params.deckId);
  const [fromDeck, setFromDeck] = useState(params.fromDeck === 'true');
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(5);
  const [state, setState] = useState<GenerationWorkflow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestedDeck, setRequestedDeck] = useState<string | null>(null);
  const [choosingDeck, setChoosingDeck] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const current = useRef<GenerationWorkflow | null>(null);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const scope = useRef(0);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const live = (epoch: number) => mounted.current && scope.current === epoch;
  const destination = data.decks.find((deck) => deck.id === (state?.request.deckId ?? deckId));
  const destinationName = destination?.name ?? state?.newDeck?.name ?? 'your deck';
  const incomingName = data.decks.find((deck) => deck.id === requestedDeck)?.name ?? 'this deck';

  const update = useCallback(
    (next: GenerationWorkflow) => {
      if (inFlight.current) return;
      current.current = next;
      setState(next);
      const repo = repository;
      const epoch = scope.current;
      if (repo) {
        writes.current = writes.current
          .catch(() => undefined)
          .then(() => repo.setState(GENERATION_KEY, next));
        void writes.current.catch((cause) => {
          if (live(epoch))
            setError(cause instanceof Error ? cause.message : 'Your edits could not be saved.');
        });
      }
    },
    [repository],
  );

  useEffect(() => {
    const epoch = ++scope.current;
    mounted.current = true;
    inFlight.current = false;
    writes.current = Promise.resolve();
    current.current = null;
    setState(null);
    setLoaded(false);
    setBusy(false);
    setError(null);
    if (repository)
      void repository
        .getState<GenerationWorkflow>(GENERATION_KEY)
        .then((saved) => {
          if (!live(epoch)) return;
          current.current = saved;
          setState(saved);
          if (saved) {
            setDeckId(saved.request.deckId);
            setNewDeck(!!saved.newDeck);
            setPrompt(saved.topic ?? saved.request.prompt);
            setCount(saved.request.count);
          }
          setLoaded(true);
        })
        .catch((cause) => {
          if (live(epoch))
            setError(
              cause instanceof Error ? cause.message : 'Your saved draft could not be opened.',
            );
        });
    return () => {
      ++scope.current;
      mounted.current = false;
    };
  }, [repository]);

  useEffect(() => {
    if (!loaded || !params.deckId) return;
    const requestedId = params.deckId;
    const deck = data.decks.find((item) => item.id === requestedId);
    setFromDeck(params.fromDeck === 'true');
    router.setParams({ deckId: undefined, fromDeck: undefined });
    if (!deck) {
      if (!current.current) {
        setDeckId('');
        setNewDeck(false);
        setChoosingDeck(true);
      }
      setError('This deck is no longer in your library. Choose another destination.');
      return;
    }
    if (current.current && current.current.request.deckId !== requestedId) {
      setRequestedDeck(requestedId);
      return;
    }
    setDeckId(deck.id);
    setNewDeck(false);
    if (!current.current) setPrompt(deck.name);
    setChoosingDeck(false);
  }, [loaded, params.deckId, params.fromDeck, data.decks]);

  const resume = useCallback(
    async (poll = false) => {
      if (!repository || !current.current || inFlight.current) return;
      inFlight.current = true;
      const epoch = scope.current;
      if (!poll) setBusy(true);
      setError(null);
      try {
        await writes.current;
        const pending = current.current;
        if (!pending) return;
        if (!pending.job) {
          await prepareGeneration(repository, pending, sync);
          await refresh();
        }
        const next = await fetchGeneration(repository, pending);
        if (live(epoch)) {
          current.current = next;
          setState(next);
        }
      } catch (cause) {
        if (live(epoch))
          setError(
            cause instanceof Error ? cause.message : 'Your request is saved. Retry when connected.',
          );
      } finally {
        if (live(epoch)) {
          inFlight.current = false;
          if (!poll) setBusy(false);
        }
      }
    },
    [repository, sync, refresh],
  );
  usePolling(
    focused &&
      active &&
      loaded &&
      !!state &&
      !state.accepted &&
      (!state.job || ['queued', 'running'].includes(state.job.status)) &&
      !busy &&
      !error,
    async () => {
      await resume(true);
    },
  );

  async function create(replacement?: { deckId: string; topic: string; count: number }) {
    if (!repository || inFlight.current) return;
    if (
      current.current &&
      (!replacement || (current.current.acceptance && !current.current.accepted))
    )
      return;
    inFlight.current = true;
    const epoch = scope.current;
    setBusy(true);
    setError(null);
    try {
      const creatingDeck = !replacement && newDeck;
      const destinationId = replacement?.deckId ?? (creatingDeck ? repository.newId() : deckId);
      const topic = (replacement?.topic ?? prompt).trim();
      const request = generationRequestSchema.parse({
        operationId: repository.newId(),
        deckId: destinationId,
        prompt: generationPrompt(
          topic,
          creatingDeck
            ? []
            : data.cards.filter((card) => card.deckId === destinationId).map((card) => card.front),
        ),
        count: replacement?.count ?? count,
      });
      const pending: GenerationWorkflow = {
        topic,
        request,
        ...(creatingDeck
          ? {
              newDeck: {
                id: destinationId,
                name: topic.slice(0, 200),
                description: '',
                color: colors.yellow,
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
      await writes.current;
      if (replacement && current.current) await repository.archive({ generation: current.current });
      await repository.setState(GENERATION_KEY, pending);
      if (!live(epoch)) return;
      current.current = pending;
      setState(pending);
      setDeckId(destinationId);
      setPrompt(topic);
      setNewDeck(creatingDeck);
      await prepareGeneration(repository, pending, sync);
      await refresh();
      const next = await fetchGeneration(repository, pending);
      if (live(epoch)) {
        current.current = next;
        setState(next);
      }
    } catch (cause) {
      if (live(epoch))
        setError(cause instanceof Error ? cause.message : 'Your request could not be started.');
    } finally {
      if (live(epoch)) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  async function accept() {
    if (!repository || !current.current || inFlight.current) return;
    inFlight.current = true;
    const epoch = scope.current;
    setBusy(true);
    setError(null);
    try {
      await writes.current;
      const before = current.current;
      if (!before) return;
      for (const id of before.acceptance?.candidateIds ?? before.selectedIds) {
        const candidate = before.acceptance?.edits[id] ?? before.drafts[id];
        if (!candidate?.front.trim() || !candidate.back.trim())
          throw new Error('Each selected card needs a title and an answer.');
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
      if (!live(epoch)) return;
      current.current = complete;
      setState(complete);
      setEditingId(null);
      await refresh();
      void sync({ silent: true });
    } catch (cause) {
      if (live(epoch))
        setError(
          cause instanceof Error
            ? cause.message
            : 'Your selection is saved. Retry to finish adding it.',
        );
    } finally {
      if (live(epoch)) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  async function clearDraft(nextDeckId = deckId, nextTopic = '') {
    if (!repository || inFlight.current) return false;
    const before = current.current;
    if (before?.acceptance && !before.accepted) return false;
    inFlight.current = true;
    const epoch = scope.current;
    setBusy(true);
    try {
      await writes.current;
      if (before) await repository.archive({ generation: before });
      await repository.setState(GENERATION_KEY, null);
      if (!live(epoch)) return false;
      current.current = null;
      setState(null);
      setDeckId(nextDeckId);
      setNewDeck(false);
      setPrompt(nextTopic);
      setError(null);
      setRequestedDeck(null);
      setEditingId(null);
      setDetailsId(null);
      return true;
    } catch (cause) {
      if (live(epoch))
        setError(cause instanceof Error ? cause.message : 'The draft could not be set aside.');
      return false;
    } finally {
      if (live(epoch)) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  function setAside(nextDeckId = state?.request.deckId ?? deckId, nextTopic = '') {
    Alert.alert(
      'Set these suggestions aside?',
      'They stay in your recovery export. No cards will be added.',
      [
        { text: 'Keep reviewing', style: 'cancel' },
        { text: 'Set aside', onPress: () => void clearDraft(nextDeckId, nextTopic) },
      ],
    );
  }
  function edit(
    candidate: GenerationCandidate,
    field: 'front' | 'back' | 'hint' | 'explanation',
    value: string,
  ) {
    if (!current.current || current.current.acceptance || inFlight.current) return;
    update({
      ...current.current,
      drafts: { ...current.current.drafts, [candidate.id]: { ...candidate, [field]: value } },
    });
  }
  const ready = state?.job?.status === 'succeeded' && !state.accepted;
  const selectedCount = state?.acceptance?.candidateIds.length ?? state?.selectedIds.length ?? 0;
  const selectionLabel = selectedCount + (selectedCount === 1 ? ' card' : ' cards');
  const selectableIds =
    state?.job?.candidates
      .filter((card) => !state.job!.acceptedCandidateIds.includes(card.id))
      .map((card) => card.id) ?? [];
  const working = !!state && (!state.job || ['queued', 'running'].includes(state.job.status));
  return (
    <Screen
      title={
        state?.accepted
          ? 'Your deck is growing'
          : ready
            ? 'Choose your cards'
            : newDeck && !state
              ? 'Create a deck'
              : 'Grow your deck'
      }
      eyebrow="02 / FOLLOW YOUR CURIOSITY"
      subtitle={
        state
          ? destinationName
          : newDeck
            ? 'A topic becomes a set of cards you can practice.'
            : 'Fresh suggestions, ready for your review.'
      }
      leading={
        fromDeck && !requestedDeck ? (
          <Back
            label="Back to deck"
            onPress={() => router.dismissTo('/decks/' + (state?.request.deckId ?? deckId))}
          />
        ) : undefined
      }
      footer={
        ready ? (
          <View style={{ gap: 8 }}>
            <Text style={[s.caption, { textAlign: 'center' }]}>
              {selectedCount} selected · {destinationName}
            </Text>
            <Button
              title={
                state.acceptance
                  ? 'Retry adding ' + selectionLabel
                  : 'Add ' + selectionLabel + ' to deck'
              }
              loading={busy}
              disabled={!selectedCount}
              onPress={() => void accept()}
            />
          </View>
        ) : undefined
      }
    >
      {!loaded && !error && <ActivityIndicator color={colors.ink} />}
      {requestedDeck && state && (
        <Panel tint>
          <Text style={s.sectionTitle}>
            {state.accepted ? 'Continue to ' + incomingName : 'You have an unfinished set'}
          </Text>
          <Text style={s.body}>
            {state.accepted
              ? 'Your cards were added to ' + destinationName + '.'
              : 'Saved suggestions for ' +
                destinationName +
                ' are still here. You came to generate for ' +
                incomingName +
                '.'}
          </Text>
          {state.acceptance && !state.accepted ? (
            <>
              <Text style={s.caption}>
                Finish adding the saved selection before switching decks.
              </Text>
              <Button
                title="Finish adding saved cards"
                loading={busy}
                onPress={() => void accept()}
              />
            </>
          ) : (
            <Button
              title={state.accepted ? 'Generate for ' + incomingName : 'Set aside & switch decks'}
              loading={busy}
              onPress={() =>
                state.accepted
                  ? void clearDraft(requestedDeck, incomingName)
                  : setAside(requestedDeck, incomingName)
              }
            />
          )}
          <Button
            title={state.accepted ? 'Stay with this deck' : 'Review saved suggestions'}
            size="compact"
            variant="ghost"
            disabled={busy}
            onPress={() => {
              setRequestedDeck(null);
              setFromDeck(false);
            }}
          />
        </Panel>
      )}
      {error && (
        <Panel style={{ borderColor: colors.danger }}>
          <Text style={{ color: colors.danger, lineHeight: 21 }}>{error}</Text>
          {state && !state.accepted && !ready && (
            <Button
              title="Retry saved request"
              size="compact"
              variant="secondary"
              disabled={busy}
              onPress={() => void resume()}
            />
          )}
          {ready && (
            <Text style={s.caption}>
              Your reviewed selection is saved. Retry below to add it once.
            </Text>
          )}
        </Panel>
      )}
      {loaded && !state && (
        <>
          {!fromDeck && (
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Button
                  title="New deck"
                  size="compact"
                  variant={newDeck ? 'primary' : 'secondary'}
                  disabled={busy}
                  onPress={() => {
                    setNewDeck(true);
                    setPrompt('');
                    setChoosingDeck(false);
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Add to a deck"
                  size="compact"
                  variant={!newDeck ? 'primary' : 'secondary'}
                  disabled={busy || !data.decks.length}
                  onPress={() => {
                    setNewDeck(false);
                    setChoosingDeck(true);
                    const first = data.decks.find((deck) => deck.id === deckId) ?? data.decks[0];
                    if (first) {
                      setDeckId(first.id);
                      setPrompt(first.name);
                    }
                  }}
                />
              </View>
            </View>
          )}
          {!newDeck && (
            <Panel style={{ padding: 16 }}>
              <View style={s.between}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={s.caption}>ADDING CARDS TO</Text>
                  <Text style={s.sectionTitle}>
                    {destination?.icon ?? '📚'} {destination?.name ?? 'Choose a deck'}
                  </Text>
                </View>
                <Button
                  title={choosingDeck ? 'Done' : 'Change'}
                  size="compact"
                  variant="ghost"
                  disabled={busy}
                  onPress={() => setChoosingDeck(!choosingDeck)}
                />
              </View>
              {choosingDeck && (
                <View style={{ gap: 6 }}>
                  {data.decks.map((deck) => (
                    <Pressable
                      key={deck.id}
                      disabled={busy}
                      onPress={() => {
                        setDeckId(deck.id);
                        setPrompt(deck.name);
                        setChoosingDeck(false);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: deckId === deck.id }}
                      style={{
                        minHeight: 44,
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: 10,
                        backgroundColor: deckId === deck.id ? colors.yellow : colors.background,
                      }}
                    >
                      <Text style={s.label}>
                        {deck.icon} {deck.name}
                        {deckId === deck.id ? '  ✓' : ''}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </Panel>
          )}
          <Field
            label={newDeck ? 'What would you like to learn?' : 'What should the new cards cover?'}
            hint={
              newDeck
                ? 'This becomes your deck title.'
                : 'Keep the deck topic or narrow it to something specific.'
            }
            value={prompt}
            editable={!busy}
            onChangeText={setPrompt}
            placeholder={
              newDeck ? 'e.g. French verbs, World history' : (destination?.name ?? 'Choose a topic')
            }
            maxLength={newDeck ? 200 : 20000}
            multiline={!newDeck}
            style={!newDeck ? { minHeight: 86 } : undefined}
          />
          <View style={{ gap: 10 }}>
            <Text style={s.label}>How many cards?</Text>
            <View style={[s.row, { gap: 8 }]}>
              {[5, 6, 7, 8, 9, 10].map((value) => (
                <Pressable
                  key={value}
                  disabled={busy}
                  onPress={() => setCount(value)}
                  accessibilityRole="radio"
                  accessibilityLabel={value + ' cards'}
                  accessibilityState={{ checked: count === value }}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: count === value ? colors.ink : colors.paper,
                    borderWidth: 1,
                    borderColor: count === value ? colors.ink : colors.line,
                  }}
                >
                  <Text style={[s.label, { color: count === value ? '#fff' : colors.ink }]}>
                    {value}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <Button
            title="Suggest cards"
            loading={busy}
            disabled={(!newDeck && !deckId) || !prompt.trim()}
            onPress={() => void create()}
          />
          <Text style={[s.caption, { textAlign: 'center' }]}>
            Review the suggestions before adding them. AI can make mistakes.
          </Text>
          {newDeck && (
            <Button
              title="Create an empty deck instead"
              size="compact"
              variant="ghost"
              onPress={() => router.push('/decks/new')}
            />
          )}
        </>
      )}
      {working && (
        <Panel tint>
          <View style={s.row}>
            {!error && <ActivityIndicator color={colors.ink} />}
            <Text style={s.sectionTitle}>
              {error
                ? 'Request paused'
                : state.job?.status === 'queued'
                  ? 'Your cards are in the queue'
                  : state.job?.status === 'running'
                    ? 'Drafting your cards'
                    : busy
                      ? 'Starting your suggestions'
                      : 'Your request is saved'}
            </Text>
          </View>
          <Text style={s.body}>{state.topic ?? state.request.prompt}</Text>
          <Text style={s.caption}>
            You can leave this screen. Your request and suggestions stay saved.
          </Text>
          {state.job && !error && (
            <Button
              title="Check status"
              size="compact"
              variant="secondary"
              loading={busy}
              onPress={() => void resume()}
            />
          )}
          {!state.job && !busy && !error && (
            <Button title="Continue saved request" size="compact" onPress={() => void resume()} />
          )}
        </Panel>
      )}
      {(state?.job?.status === 'failed' || state?.job?.status === 'canceled') && (
        <Panel>
          <Text style={s.sectionTitle}>Let’s try another set</Text>
          <Text style={s.body}>{state.job.error?.message ?? 'This request was canceled.'}</Text>
          <Button
            title="Try this topic again"
            loading={busy}
            onPress={() =>
              void create({
                deckId: state.request.deckId,
                topic: state.topic ?? state.request.prompt,
                count: state.request.count,
              })
            }
          />
          <Button
            title="Change the topic"
            size="compact"
            variant="ghost"
            disabled={busy}
            onPress={() => void clearDraft(state.request.deckId, '')}
          />
        </Panel>
      )}
      {ready && state && (
        <>
          <View style={s.between}>
            <Text style={s.caption}>Choose cards to keep. Edit any suggestion.</Text>
            <Button
              title={selectedCount === selectableIds.length ? 'Clear all' : 'Select all'}
              size="compact"
              variant="ghost"
              disabled={!!state.acceptance || busy}
              onPress={() =>
                update({
                  ...state,
                  selectedIds: selectedCount === selectableIds.length ? [] : selectableIds,
                })
              }
            />
          </View>
          {state.job!.candidates.map((original, index) => {
            const candidate = state.drafts[original.id] ?? original;
            const selected = state.selectedIds.includes(candidate.id);
            const alreadySaved = state.job!.acceptedCandidateIds.includes(candidate.id);
            const locked = busy || !!state.acceptance || alreadySaved;
            const editing = editingId === candidate.id;
            return (
              <Panel
                key={candidate.id}
                style={{
                  padding: 18,
                  borderColor: selected ? colors.accent : colors.line,
                  backgroundColor: selected ? colors.paper : colors.background,
                }}
              >
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={'Select card ' + (index + 1) + ': ' + candidate.front}
                  accessibilityState={{ checked: selected, disabled: locked }}
                  disabled={locked}
                  onPress={() =>
                    update({
                      ...state,
                      selectedIds: selected
                        ? state.selectedIds.filter((id) => id !== candidate.id)
                        : [...state.selectedIds, candidate.id],
                    })
                  }
                  style={[s.between, { minHeight: 44 }]}
                >
                  <Text style={s.caption}>
                    {String(index + 1).padStart(2, '0')} ·{' '}
                    {alreadySaved ? 'Already added' : selected ? 'Selected' : 'Not selected'}
                  </Text>
                  <View
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 8,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: selected ? colors.ink : colors.paper,
                      borderWidth: 1,
                      borderColor: selected ? colors.ink : colors.muted,
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '800' }}>{selected ? '✓' : ''}</Text>
                  </View>
                </Pressable>
                {editing ? (
                  <>
                    <Field
                      label="Title"
                      multiline
                      value={candidate.front}
                      editable={!locked}
                      onChangeText={(value) => edit(candidate, 'front', value)}
                      maxLength={20000}
                    />
                    <Field
                      label="Answer"
                      multiline
                      value={candidate.back}
                      editable={!locked}
                      onChangeText={(value) => edit(candidate, 'back', value)}
                      maxLength={30000}
                    />
                    {detailsId === candidate.id && (
                      <>
                        <Field
                          label="Hint"
                          value={candidate.hint}
                          editable={!locked}
                          onChangeText={(value) => edit(candidate, 'hint', value)}
                          maxLength={10000}
                        />
                        <Field
                          label="Explanation"
                          multiline
                          value={candidate.explanation}
                          editable={!locked}
                          onChangeText={(value) => edit(candidate, 'explanation', value)}
                          maxLength={30000}
                        />
                      </>
                    )}
                    <View style={s.between}>
                      <Button
                        title={detailsId === candidate.id ? 'Hide details' : 'Hint & explanation'}
                        size="compact"
                        variant="ghost"
                        onPress={() =>
                          setDetailsId(detailsId === candidate.id ? null : candidate.id)
                        }
                      />
                      <Button
                        title="Done editing"
                        size="compact"
                        variant="secondary"
                        onPress={() => setEditingId(null)}
                      />
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={[s.sectionTitle, { fontSize: 18, lineHeight: 25 }]}>
                      {candidate.front}
                    </Text>
                    <Text style={[s.body, { color: colors.ink }]}>{candidate.back}</Text>
                    {!!candidate.hint && <Text style={s.caption}>Hint: {candidate.hint}</Text>}
                    <Button
                      title="Edit card"
                      size="compact"
                      variant="ghost"
                      disabled={locked}
                      onPress={() => setEditingId(candidate.id)}
                    />
                  </>
                )}
              </Panel>
            );
          })}
          {!!state.acceptance && (
            <Text style={s.caption}>
              Your selection is locked while saving. Retry adds these same cards once.
            </Text>
          )}
        </>
      )}
      {state?.accepted && (
        <Panel tint>
          <Text style={s.sectionTitle}>{selectionLabel} added</Text>
          <Text style={s.body}>Ready to practice in {destinationName}.</Text>
          <Button
            title="Open deck"
            disabled={busy}
            onPress={() => router.dismissTo('/decks/' + state.request.deckId)}
          />
          <Button
            title="Generate more cards"
            variant="secondary"
            loading={busy}
            onPress={() =>
              void create({
                deckId: state.request.deckId,
                topic: state.topic ?? state.request.prompt,
                count: state.request.count,
              })
            }
          />
          <Button
            title="Try a new topic in this deck"
            variant="ghost"
            size="compact"
            disabled={busy}
            onPress={() => void clearDraft(state.request.deckId, '')}
          />
        </Panel>
      )}
      {state && !state.acceptance && !state.accepted && !busy && (
        <Button
          title="Set suggestions aside"
          variant="ghost"
          size="compact"
          onPress={() => setAside()}
        />
      )}
    </Screen>
  );
}
