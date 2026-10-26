import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Card, Deck } from '@recollect/contracts';
import { initialSchedule } from '@recollect/scheduler';

const rig = vi.hoisted(() => ({
  params: { id: 'new', deckId: 'deck-id' } as { id: string; deckId?: string },
  deck: null as Deck | null,
  card: null as Card | null,
  extraCards: [] as Card[],
  nextId: 0,
  failRefresh: false,
  saveCard: vi.fn(async () => {}),
  getState: vi.fn(async () => null),
  setState: vi.fn(async () => {}),
  dismissTo: vi.fn(),
  push: vi.fn(),
  alert: vi.fn(),
  reportError: vi.fn(),
}));
vi.mock('react-native', () => ({
  Alert: { alert: (...args: unknown[]) => rig.alert(...args) },
  View: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('view', props, children),
  Text: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('text', props, children),
  Pressable: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('pressable', props, children),
}));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => rig.params,
  router: {
    dismissTo: (...args: unknown[]) => rig.dismissTo(...args),
    push: (...args: unknown[]) => rig.push(...args),
  },
}));
vi.mock('../src/store', () => ({
  useStore: () => {
    const repository = {
      newId: () => 'stable-' + ++rig.nextId,
      saveCard: (...args: unknown[]) => rig.saveCard(...args),
      getState: (...args: unknown[]) => rig.getState(...args),
      setState: (...args: unknown[]) => rig.setState(...args),
    };
    return {
      data: {
        decks: rig.deck ? [rig.deck] : [],
        cards: [...(rig.card ? [rig.card] : []), ...rig.extraCards],
      },
      repository,
      mutate: async (work: (repo: typeof repository) => Promise<unknown>) => {
        await work(repository);
        if (rig.failRefresh) {
          rig.failRefresh = false;
          throw new Error('Refresh failed');
        }
      },
    };
  },
}));
vi.mock('../src/answer-generator', () => ({
  default: (props: Record<string, unknown>) => React.createElement('answer-generator', props),
}));
vi.mock('../src/brand-patterns', () => ({ BrandPattern: () => null, DeckArtwork: () => null }));
vi.mock('../src/deck-sharing', () => ({ default: () => null }));
vi.mock('../src/deck-photo', () => ({ chooseDeckPhoto: async () => null }));
// Publishing has its own lifecycle suite; keep this fixture focused on local card editing.
vi.mock('../src/deck-marketplace', () => ({ default: () => null }));
vi.mock('../src/marketplace-ui', () => ({ MarketplaceEntry: () => null }));
vi.mock('../src/ui', () => ({
  Text: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('text', props, children),
  colors: {},
  s: {},
  reportError: (...args: unknown[]) => rig.reportError(...args),
  Screen: ({
    children,
    leading,
    footer,
    ...props
  }: {
    children: React.ReactNode;
    leading: React.ReactNode;
    footer: React.ReactNode;
  }) => React.createElement('screen', props, leading, children, footer),
  Back: (props: Record<string, unknown>) => React.createElement('back', props),
  Button: (props: Record<string, unknown>) => React.createElement('button', props),
  Field: (props: Record<string, unknown>) => React.createElement('field', props),
  Panel: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('panel', props, children),
  Empty: (props: Record<string, unknown>) => React.createElement('empty', props),
}));
import CardEditor from '../app/cards/[id]';
import DeckDetail from '../app/decks/[id]';
import Decks from '../app/(tabs)/decks';

let renderer: ReactTestRenderer | null = null;
const when = '2026-10-13T10:00:00.000Z';
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  rig.params = { id: 'new', deckId: 'deck-id' };
  rig.deck = {
    id: 'deck-id',
    ownerId: 'owner-id',
    name: 'Literature',
    description: '',
    color: '#DDE8D9',
    icon: '📚',
    isSilenced: false,
    silencedUntil: null,
    version: 1,
    createdAt: when,
    updatedAt: when,
    deletedAt: null,
  };
  rig.card = null;
  rig.extraCards = [];
  rig.nextId = 0;
  rig.failRefresh = false;
  rig.saveCard.mockResolvedValue(undefined);
  rig.getState.mockResolvedValue(null);
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});
const field = (label: string) =>
  renderer!.root.findAllByType('field').find((node) => node.props.label === label)!;
const button = (title: string) =>
  renderer!.root.findAllByType('button').find((node) => node.props.title === title)!;
async function mount() {
  await act(async () => {
    renderer = create(React.createElement(CardEditor));
  });
}
async function enter(front: string, back: string) {
  await act(async () => {
    field('Front').props.onChangeText(front);
    field('Answer').props.onChangeText(back);
  });
}
it('saves successive cards in the chosen deck, clears fields, and changes only the new answer scope', async () => {
  await mount();
  expect(renderer!.root.findByType('screen').props.subtitle).toBe('In Literature');
  expect(renderer!.root.findByType('answer-generator').props.cardId).toBe('new');
  await enter(' First question ', ' First answer ');
  await act(async () => button('Save & add another').props.onPress());
  expect(rig.saveCard).toHaveBeenLastCalledWith(
    expect.objectContaining({
      id: 'stable-1',
      deckId: 'deck-id',
      front: 'First question',
      back: 'First answer',
    }),
    undefined,
  );
  expect(field('Front').props.value).toBe('');
  expect(field('Answer').props.value).toBe('');
  expect(renderer!.root.findByType('answer-generator').props.cardId).toBe('stable-2');
  expect(rig.dismissTo).not.toHaveBeenCalled();
  await enter('Second question', 'Second answer');
  await act(async () => button('Save card').props.onPress());
  expect(rig.saveCard).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: 'stable-2', deckId: 'deck-id' }),
    undefined,
  );
  expect(rig.dismissTo).toHaveBeenCalledWith({
    pathname: '/decks/[id]',
    params: { id: 'deck-id' },
  });
});
it('reuses the assigned card ID when a save succeeds but refresh fails', async () => {
  await mount();
  await enter('Question', 'Answer');
  rig.failRefresh = true;
  await act(async () => button('Save & add another').props.onPress());
  expect(field('Front').props.value).toBe('Question');
  expect(rig.reportError).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'Refresh failed' }),
  );
  await act(async () => button('Save & add another').props.onPress());
  expect(rig.saveCard.mock.calls.map((args) => (args[0] as { id: string }).id)).toEqual([
    'stable-1',
    'stable-1',
  ]);
  expect(renderer!.root.findByType('answer-generator').props.cardId).toBe('stable-2');
});
it('keeps optional details hidden and retains an edited card baseline through a concurrent refresh', async () => {
  rig.card = {
    id: 'card-id',
    deckId: 'deck-id',
    ownerId: 'owner-id',
    front: 'Original',
    back: 'Original answer',
    hint: 'Hint',
    explanation: 'Explanation',
    tags: ['tag'],
    aiGenerated: false,
    version: 4,
    createdAt: when,
    updatedAt: when,
    deletedAt: null,
    schedule: initialSchedule(when),
  };
  const baseline = rig.card;
  rig.params = { id: 'card-id' };
  await mount();
  expect(renderer!.root.findAllByType('field').map((node) => node.props.label)).toEqual([
    'Front',
    'Answer',
  ]);
  await enter('My edit', 'My answer');
  rig.card = { ...rig.card, front: 'Remote edit', version: 5 };
  await act(async () => renderer!.update(React.createElement(CardEditor)));
  await act(async () => button('Save changes').props.onPress());
  expect(rig.saveCard).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'card-id', front: 'My edit', hint: 'Hint', tags: ['tag'] }),
    baseline,
  );
});
it('explains a pending answer save lock and enables saving again after setting the request aside', async () => {
  await mount();
  await enter('Question', 'My own answer');
  await act(async () => renderer!.root.findByType('answer-generator').props.onPendingChange(true));
  expect(button('Save & add another').props.disabled).toBe(true);
  const copy = renderer!.root
    .findAllByType('text')
    .map((node) => node.props.children)
    .join(' ');
  expect(copy).toContain('Set request aside');
  await act(async () => renderer!.root.findByType('answer-generator').props.onPendingChange(false));
  expect(button('Save & add another').props.disabled).toBe(false);
});
it('asks before discarding unsaved card entry on the visible Back action', async () => {
  await mount();
  await enter('Unsaved question', 'Unsaved answer');
  await act(async () => renderer!.root.findByType('back').props.onPress());
  expect(rig.dismissTo).not.toHaveBeenCalled();
  expect(rig.alert).toHaveBeenCalledWith(
    'Discard unsaved edits?',
    expect.any(String),
    expect.any(Array),
  );
  const actions = rig.alert.mock.calls[0]![2] as { text: string; onPress?: () => void }[];
  await act(async () => actions.find((action) => action.text === 'Discard edits')!.onPress!());
  expect(rig.dismissTo).toHaveBeenCalledWith({
    pathname: '/decks/[id]',
    params: { id: 'deck-id' },
  });
});

function populateDeck(count: number) {
  rig.extraCards = Array.from({ length: count }, (_, index) => ({
    id: 'card-' + index,
    deckId: 'deck-id',
    ownerId: 'owner-id',
    front: 'Question ' + index,
    back: 'Answer ' + index,
    hint: '',
    explanation: '',
    tags: index === count - 1 ? ['last-card'] : [],
    aiGenerated: false,
    version: 1,
    createdAt: when,
    updatedAt: when,
    deletedAt: null,
    schedule: initialSchedule(when),
  }));
}
const renderedCards = () =>
  renderer!.root
    .findAllByType('pressable')
    .filter((node) => String(node.props.accessibilityLabel).startsWith('Edit card:'));
it('offers both due review and all-card practice for the same deck with due cards', async () => {
  rig.params = { id: 'deck-id' };
  populateDeck(3);
  rig.extraCards = rig.extraCards.map((card) => ({
    ...card,
    schedule: { ...card.schedule, dueAt: '2020-01-01T00:00:00.000Z' },
  }));
  await act(async () => {
    renderer = create(React.createElement(DeckDetail));
  });
  expect(button('Review 3 due')).toBeDefined();
  expect(button('Practice all')).toBeDefined();
  await act(async () => button('Review 3 due').props.onPress());
  expect(rig.push).toHaveBeenLastCalledWith({
    pathname: '/review',
    params: { deckId: 'deck-id', practice: 'false' },
  });
  await act(async () => button('Practice all').props.onPress());
  expect(rig.push).toHaveBeenLastCalledWith({
    pathname: '/review',
    params: { deckId: 'deck-id', practice: 'true' },
  });
  expect(renderer!.root.findByType('back').props.label).toBe('Decks');
  await act(async () => renderer!.root.findByType('back').props.onPress());
  expect(rig.dismissTo).toHaveBeenLastCalledWith('/decks');
});
it('bounds a large deck to 20 card rows while searching all cards and resetting pagination', async () => {
  rig.params = { id: 'deck-id' };
  populateDeck(45);
  await act(async () => {
    renderer = create(React.createElement(DeckDetail));
  });
  expect(renderedCards()).toHaveLength(20);
  const pressables = renderer!.root.findAllByType('pressable');
  expect(pressables[0]!.props.accessibilityLabel).toBe('Deck settings');
  expect(
    renderer!.root.findAllByType('button').some((node) => node.props.title === 'Delete deck'),
  ).toBe(false);
  await act(async () => button('Show more cards').props.onPress());
  expect(renderedCards()).toHaveLength(40);
  await act(async () => field('Search cards').props.onChangeText('last-card'));
  expect(renderedCards()).toHaveLength(1);
  expect(renderedCards()[0]!.props.accessibilityLabel).toBe('Edit card: Question 44');
  await act(async () => field('Search cards').props.onChangeText(''));
  expect(renderedCards()).toHaveLength(20);
  await act(async () => renderer!.root.findAllByType('pressable')[0]!.props.onPress());
  expect(button('Delete deck')).toBeDefined();
});
it('hands generation an explicit deck destination and keeps Add card one tap away', async () => {
  rig.params = { id: 'deck-id' };
  await act(async () => {
    renderer = create(React.createElement(DeckDetail));
  });
  await act(async () => button('Generate cards').props.onPress());
  expect(rig.dismissTo).toHaveBeenCalledWith({
    pathname: '/generate',
    params: { deckId: 'deck-id', fromDeck: 'true' },
  });
  await act(async () => button('+ Add card').props.onPress());
  expect(rig.push).toHaveBeenCalledWith({
    pathname: '/cards/[id]',
    params: { id: 'new', deckId: 'deck-id' },
  });
});
it('opens the image editor by tapping the deck header artwork', async () => {
  rig.params = { id: 'deck-id' };
  await act(async () => {
    renderer = create(React.createElement(DeckDetail));
  });
  const action = renderer!.root.findByType('screen').props.action;
  expect(action.props.accessibilityLabel).toBe('Change deck image');
  await act(async () => action.props.onPress());
  expect(button('Choose image')).toBeDefined();
  expect(button('Save changes')).toBeDefined();
});
it('opens a deck from the entire row and matches its description in library search', async () => {
  rig.deck = { ...rig.deck!, description: 'Fiction and authors' };
  await act(async () => {
    renderer = create(React.createElement(Decks));
  });
  const row = renderer!.root.findByType('pressable');
  expect(row.props.accessibilityLabel).toContain('Open Literature');
  await act(async () => row.props.onPress());
  expect(rig.push).toHaveBeenCalledWith({
    pathname: '/decks/[id]',
    params: { id: 'deck-id' },
  });
  await act(async () => field('Search decks').props.onChangeText('authors'));
  expect(renderer!.root.findAllByType('pressable')).toHaveLength(1);
  await act(async () => field('Search decks').props.onChangeText('  missing  '));
  expect(renderer!.root.findAllByType('pressable')).toHaveLength(0);
  expect(renderer!.root.findByType('empty').props.title).toBe('No decks found');
});
