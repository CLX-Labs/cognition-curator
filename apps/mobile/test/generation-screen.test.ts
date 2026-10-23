import React from 'react';
import { randomUUID } from 'node:crypto';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Card, Deck, GenerationJob } from '@recollect/contracts';
import { initialSchedule } from '@recollect/scheduler';
import { Repository, type LocalSnapshot } from '../src/repository';
import { TestDatabase } from './sqlite';
import type { GenerationWorkflow } from '../src/generation';
import { saveAIConsent } from '../src/ai-consent';

const rig = vi.hoisted(() => ({
  params: {} as { deckId?: string; fromDeck?: string },
  repo: null as Repository | null,
  data: null as LocalSnapshot | null,
  request: vi.fn(),
  alert: vi.fn(),
  dismissTo: vi.fn(),
  focused: true,
  active: true,
}));
vi.mock('react-native', () => ({
  Text: ({ children }: { children: React.ReactNode }) => React.createElement('text', {}, children),
  View: ({ children }: { children: React.ReactNode }) => React.createElement('view', {}, children),
  Pressable: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('pressable', props, children),
  ActivityIndicator: () => React.createElement('spinner'),
  Alert: { alert: rig.alert },
}));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => rig.params,
  router: {
    setParams: (next: typeof rig.params) => {
      rig.params = { ...rig.params, ...next };
    },
    dismissTo: rig.dismissTo,
    push: vi.fn(),
  },
}));
vi.mock('expo-router/react-navigation', () => ({ useIsFocused: () => rig.focused }));
vi.mock('../src/polling', async () => ({
  ...(await vi.importActual<typeof import('../src/polling')>('../src/polling')),
  useAppActive: () => rig.active,
}));
vi.mock('../src/store', () => ({
  useStore: () => ({
    repository: rig.repo,
    data: rig.data,
    sync: async () => {},
    refresh: async () => {
      rig.data = await rig.repo!.snapshot();
    },
  }),
}));
vi.mock('../src/api', () => ({ api: { request: rig.request } }));
vi.mock('../src/brand-patterns', () => ({ BrandPattern: () => null, DeckArtwork: () => null }));
vi.mock('../src/ui', () => ({
  Text: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('text', props, children),
  Screen: ({
    children,
    footer,
    title,
  }: {
    children: React.ReactNode;
    footer: React.ReactNode;
    title: string;
  }) =>
    React.createElement('screen', { title }, children, React.createElement('footer', {}, footer)),
  Panel: ({ children }: { children: React.ReactNode }) =>
    React.createElement('panel', {}, children),
  Button: (props: object) => React.createElement('button', props),
  Back: (props: object) => React.createElement('back', props),
  Field: (props: object) => React.createElement('field', props),
  colors: { yellow: '#E7ED9B' },
  s: {},
}));
import GenerateScreen from '../app/(tabs)/generate';
import AnswerGenerator from '../src/answer-generator';

const timestamp = '2026-10-13T12:00:00.000Z';
let db: TestDatabase;
let renderer: ReactTestRenderer | null = null;
let decks: Deck[];
let card: Card;
function job(deckId: string): GenerationJob {
  return {
    id: randomUUID(),
    deckId,
    prompt: 'Biology',
    count: 5,
    status: 'succeeded',
    error: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    acceptedCandidateIds: [],
    candidates: Array.from({ length: 5 }, (_, index) => ({
      id: randomUUID(),
      front: 'New question ' + index,
      back: 'Answer ' + index,
      hint: '',
      explanation: '',
      tags: [],
    })),
  };
}
function workflow(generated: GenerationJob): GenerationWorkflow {
  return {
    topic: 'Biology',
    request: {
      operationId: randomUUID(),
      deckId: generated.deckId,
      prompt: 'Biology',
      count: 5,
    },
    job: generated,
    drafts: Object.fromEntries(generated.candidates.map((candidate) => [candidate.id, candidate])),
    selectedIds: generated.candidates.map((candidate) => candidate.id),
    acceptance: null,
    accepted: false,
  };
}
function button(title: string) {
  return renderer!.root.findAllByType('button').find((node) => node.props.title === title)!;
}
async function press(title: string) {
  expect(button(title)).toBeDefined();
  await act(async () => {
    await button(title).props.onPress();
  });
}
function content() {
  return JSON.stringify(renderer!.toJSON());
}
async function mount() {
  await act(async () => {
    renderer = create(React.createElement(GenerateScreen));
  });
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(timestamp));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  rig.focused = true;
  rig.active = true;
  db = new TestDatabase();
  rig.repo = new Repository(db, randomUUID(), randomUUID(), randomUUID);
  await rig.repo.initialize();
  await saveAIConsent(rig.repo, true);
  decks = ['Biology', 'World history'].map((name) => ({
    id: randomUUID(),
    ownerId: rig.repo!.ownerId,
    name,
    description: '',
    color: '#DDE8D9',
    icon: '📚',
    isSilenced: false,
    silencedUntil: null,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  }));
  card = {
    id: randomUUID(),
    ownerId: rig.repo.ownerId,
    deckId: decks[0]!.id,
    front: 'What is ATP?',
    back: 'An energy-carrying molecule.',
    hint: '',
    explanation: '',
    tags: [],
    aiGenerated: false,
    schedule: initialSchedule(timestamp),
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  await rig.repo.applyChanges(
    [
      { revision: '1', entity: 'deck', data: decks[0]! },
      { revision: '2', entity: 'deck', data: decks[1]! },
      { revision: '3', entity: 'card', data: card },
    ],
    '3',
  );
  rig.data = await rig.repo.snapshot();
  rig.params = { deckId: decks[0]!.id, fromDeck: 'true' };
});
afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = null;
  db.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('opens the explicit deck with its topic prefilled and starts one saved request containing existing-card context', async () => {
  const generated = job(decks[0]!.id);
  rig.request.mockResolvedValue(generated);
  await mount();
  expect(renderer!.root.findByType('field').props.value).toBe('Biology');
  expect(content()).toContain('ADDING CARDS TO');
  await press('Suggest cards');
  const body = rig.request.mock.calls[0]![1].body;
  expect(body).toMatchObject({ deckId: decks[0]!.id, count: 5 });
  expect(body.prompt).toContain('What is ATP?');
  const saved = await rig.repo!.getState<GenerationWorkflow>('generation');
  expect(saved!.topic).toBe('Biology');
  expect(saved!.request.operationId).toBe(body.operationId);
  expect(renderer!.root.findAllByType('field')).toHaveLength(0);
  expect(renderer!.root.findByType('footer').findByType('button').props.title).toBe(
    'Add 5 cards to deck',
  );
});

it('never overwrites another deck’s saved suggestions until the learner chooses to set aside and switch', async () => {
  const saved = workflow(job(decks[0]!.id));
  await rig.repo!.setState('generation', saved);
  rig.params = { deckId: decks[1]!.id, fromDeck: 'true' };
  const archive = vi.spyOn(rig.repo!, 'archive');
  await mount();
  expect(content()).toContain('You have an unfinished set');
  expect(content()).toContain('World history');
  expect(await rig.repo!.getState('generation')).toEqual(saved);
  await press('Set aside & switch decks');
  expect(await rig.repo!.getState('generation')).toEqual(saved);
  const choices = rig.alert.mock.calls.at(-1)![2];
  await act(async () => {
    await choices.find((choice: { text: string }) => choice.text === 'Set aside').onPress();
  });
  expect(archive).toHaveBeenCalledWith({ generation: saved });
  expect(await rig.repo!.getState('generation')).toBeNull();
  expect(renderer!.root.findByType('field').props.value).toBe('World history');
  rig.request.mockResolvedValue(job(decks[1]!.id));
  await press('Suggest cards');
  expect(rig.request.mock.calls[0]![1].body.deckId).toBe(decks[1]!.id);
});

it('preserves the reviewed selection and exact acceptance receipt across a lost response, then switches decks only after completing it', async () => {
  const saved = workflow(job(decks[0]!.id));
  await rig.repo!.setState('generation', saved);
  await mount();
  await press('Clear all');
  const check = renderer!.root
    .findAllByType('pressable')
    .find((node) => node.props.accessibilityRole === 'checkbox')!;
  await act(async () => {
    check.props.onPress();
  });
  await act(async () => {
    renderer!.root
      .findAllByType('button')
      .find((node) => node.props.title === 'Edit card')!
      .props.onPress();
  });
  await act(async () => {
    renderer!.root
      .findAllByType('field')
      .find((node) => node.props.label === 'Title')!
      .props.onChangeText('Reviewed question');
  });
  rig.request.mockRejectedValueOnce(new Error('Connection lost after saving'));
  await press('Add 1 card to deck');
  const receipt = rig.request.mock.calls[0]![1].body;
  const durable = (await rig.repo!.getState<GenerationWorkflow>('generation'))!;
  expect(durable.acceptance!.operationId).toBe(receipt.operationId);
  expect(durable.acceptance!.edits[receipt.candidateIds[0]]!.front).toBe('Reviewed question');
  expect(button('Select all').props.disabled).toBe(true);
  rig.params = { deckId: decks[1]!.id, fromDeck: 'true' };
  await act(async () => {
    renderer!.update(React.createElement(GenerateScreen));
  });
  expect(button('Set aside & switch decks')).toBeUndefined();
  expect(button('Finish adding saved cards')).toBeDefined();
  const original = saved.job!.candidates[0]!;
  const acceptedCard: Card = { ...card, ...original, aiGenerated: true, version: 1 };
  rig.request.mockResolvedValueOnce({ cards: [acceptedCard], revision: '4' });
  await press('Finish adding saved cards');
  expect(rig.request.mock.calls[1]![1].body).toEqual(receipt);
  expect((await rig.repo!.snapshot()).cards.filter((item) => item.id === original.id)).toHaveLength(
    1,
  );
  expect((await rig.repo!.snapshot()).cards.find((item) => item.id === original.id)!.front).toBe(
    'Reviewed question',
  );
  await press('Generate for World history');
  expect(renderer!.root.findByType('field').props.value).toBe('World history');
});

it('generates more with one tap in the same deck and includes cards just added in its context', async () => {
  const generated = job(decks[0]!.id);
  const saved = {
    ...workflow(generated),
    accepted: true,
    acceptance: {
      operationId: randomUUID(),
      candidateIds: generated.candidates.map((candidate) => candidate.id),
      edits: Object.fromEntries(generated.candidates.map((candidate) => [candidate.id, candidate])),
    },
  };
  const added = { ...card, ...generated.candidates[0]!, aiGenerated: true };
  await rig.repo!.applyChanges([{ revision: '4', entity: 'card', data: added }], '4');
  await rig.repo!.setState('generation', saved);
  rig.data = await rig.repo!.snapshot();
  rig.request.mockResolvedValue(job(decks[0]!.id));
  await mount();
  await press('Generate more cards');
  expect(rig.request).toHaveBeenCalledTimes(1);
  const request = rig.request.mock.calls[0]![1].body;
  expect(request.deckId).toBe(decks[0]!.id);
  expect(request.operationId).not.toBe(saved.request.operationId);
  expect(request.prompt).toContain(added.front);
  expect(request.prompt).toContain('Biology');
});

it('keeps an interrupted answer request blocking the editor until exact retry completes, then uses only the reviewed answer', async () => {
  const pendingChanged = vi.fn();
  const use = vi.fn();
  const restore = vi.fn();
  await act(async () => {
    renderer = create(
      React.createElement(AnswerGenerator, {
        cardId: 'new',
        deckId: decks[0]!.id,
        question: 'What is ATP?',
        onUse: use,
        onRestoreQuestion: restore,
        onPendingChange: pendingChanged,
      }),
    );
  });
  rig.request.mockRejectedValueOnce(new Error('Offline'));
  await press('✦ Generate answer');
  const body = rig.request.mock.calls[0]![1].body;
  const key = 'answer:' + decks[0]!.id + ':new';
  const saved = (await rig.repo!.getState<GenerationWorkflow>(key))!;
  expect(saved.request.operationId).toBe(body.operationId);
  expect(pendingChanged).toHaveBeenLastCalledWith(true);
  const generated = job(decks[0]!.id);
  rig.request.mockResolvedValueOnce({
    ...generated,
    count: 1,
    candidates: generated.candidates.slice(0, 1),
    prompt: saved.request.prompt,
  });
  await press('Retry answer request');
  expect(rig.request.mock.calls[1]![1].body).toEqual(body);
  expect(pendingChanged).toHaveBeenLastCalledWith(false);
  expect(use).not.toHaveBeenCalled();
  await press('Use this answer');
  expect(use).toHaveBeenCalledWith(generated.candidates[0]!.back);
  expect((await rig.repo!.snapshot()).cards).toHaveLength(1);
});

it('can set an unfinished answer aside to unlock manual saving while retaining a recovery copy', async () => {
  const saved = {
    ...workflow(job(decks[0]!.id)),
    sourceQuestion: 'Saved question',
    job: null,
  };
  const key = 'answer:' + decks[0]!.id + ':draft';
  await rig.repo!.setState(key, saved);
  const pendingChanged = vi.fn();
  const restore = vi.fn();
  const archive = vi.spyOn(rig.repo!, 'archive');
  await act(async () => {
    renderer = create(
      React.createElement(AnswerGenerator, {
        cardId: 'draft',
        deckId: decks[0]!.id,
        question: 'Edited question',
        onUse: vi.fn(),
        onRestoreQuestion: restore,
        onPendingChange: pendingChanged,
      }),
    );
  });
  expect(pendingChanged).toHaveBeenLastCalledWith(true);
  await press('Restore saved question');
  expect(restore).toHaveBeenCalledWith('Saved question');
  await press('Set request aside');
  expect(archive).toHaveBeenCalledWith({ answerGeneration: saved });
  expect(await rig.repo!.getState(key)).toBeNull();
  expect(pendingChanged).toHaveBeenLastCalledWith(false);
});

it('automatically checks an interrupted saved request using its original operation ID', async () => {
  const generated = job(decks[0]!.id);
  const saved = { ...workflow(generated), job: null, drafts: {}, selectedIds: [] };
  await rig.repo!.setState('generation', saved);
  rig.request.mockResolvedValue(generated);
  await mount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500);
  });
  expect(rig.request).toHaveBeenCalledExactlyOnceWith('/v1/generations', {
    method: 'POST',
    body: saved.request,
    ownerId: rig.repo!.ownerId,
  });
  expect(content()).toContain('Add 5 cards to deck');
  expect((await rig.repo!.getState<GenerationWorkflow>('generation'))!.job!.id).toBe(generated.id);
});

it('keeps checking a queued job after unchanged responses until saved suggestions are ready', async () => {
  const generated = job(decks[0]!.id);
  const queued = { ...generated, status: 'queued' as const, candidates: [] };
  await rig.repo!.setState('generation', { ...workflow(queued), drafts: {}, selectedIds: [] });
  rig.request.mockResolvedValueOnce(queued).mockResolvedValueOnce(generated);
  await mount();
  expect(content()).toContain('Your cards are in the queue');
  for (let i = 0; i < 2; i++)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
  expect(rig.request).toHaveBeenCalledTimes(2);
  expect(
    rig.request.mock.calls.every(
      ([route, options]) => route === '/v1/generations/' + generated.id && !options.method,
    ),
  ).toBe(true);
  expect(content()).toContain('Add 5 cards to deck');
});

it('can explicitly check a queued request even when automatic polling is paused', async () => {
  rig.focused = false;
  const generated = job(decks[0]!.id);
  const queued = { ...generated, status: 'queued' as const, candidates: [] };
  await rig.repo!.setState('generation', { ...workflow(queued), drafts: {}, selectedIds: [] });
  rig.request.mockResolvedValue(generated);
  await mount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(7500);
  });
  expect(rig.request).not.toHaveBeenCalled();
  await press('Check status');
  expect(rig.request).toHaveBeenCalledExactlyOnceWith('/v1/generations/' + generated.id, {
    ownerId: rig.repo!.ownerId,
  });
  expect(content()).toContain('Add 5 cards to deck');
});

it('does not send a second status check while an automatic check is still running', async () => {
  const generated = job(decks[0]!.id);
  const queued = { ...generated, status: 'queued' as const, candidates: [] };
  await rig.repo!.setState('generation', { ...workflow(queued), drafts: {}, selectedIds: [] });
  let finish!: (value: GenerationJob) => void;
  rig.request.mockImplementationOnce(
    () =>
      new Promise<GenerationJob>((resolve) => {
        finish = resolve;
      }),
  );
  await mount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500);
  });
  await press('Check status');
  expect(rig.request).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish(generated);
  });
  expect(content()).toContain('Add 5 cards to deck');
});
