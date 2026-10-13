import React from 'react';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Card, Deck } from '@recollect/contracts';
import { initialSchedule } from '@recollect/scheduler';
import type { LocalSnapshot, Repository } from '../src/repository';

const rig = vi.hoisted(() => ({
  data: null as LocalSnapshot | null,
  params: {} as { practice?: string; deckId?: string },
  mutate: vi.fn<(work: (repository: Repository) => Promise<unknown>) => Promise<unknown>>(),
  rate: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  scrollTo: vi.fn(),
  alert: vi.fn(),
}));
vi.mock('../src/store', () => ({
  useStore: () => ({ data: rig.data, mutate: rig.mutate, syncState: 'idle', sync: vi.fn() }),
}));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => rig.params,
  useSegments: () => [],
  router: {
    canGoBack: () => true,
    back: vi.fn(),
    replace: vi.fn(),
    dismissTo: vi.fn(),
    navigate: vi.fn(),
  },
}));
vi.mock('react-native', () => {
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement(name, props, children);
  return {
    View: host('view'),
    Text: host('text'),
    TextInput: host('input'),
    Pressable: host('pressable'),
    KeyboardAvoidingView: host('keyboard-avoiding'),
    ScrollView: React.forwardRef(
      ({ children, ...props }: { children?: React.ReactNode }, ref) => {
        React.useImperativeHandle(ref, () => ({ scrollTo: rig.scrollTo }));
        return React.createElement('scroll', props, children);
      },
    ),
    ActivityIndicator: host('spinner'),
    Alert: { alert: rig.alert },
    Platform: { OS: 'ios' },
    StyleSheet: { create: <T>(styles: T) => styles },
  };
});
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('safe-area', props, children),
}));
import ReviewScreen from '../src/review-screen';
import { Button } from '../src/ui';

const timestamp = '2026-10-13T12:00:00.000Z';
const deck: Deck = {
  id: 'a0000000-0000-4000-8000-000000000000',
  ownerId: 'b0000000-0000-4000-8000-000000000000',
  name: 'Literature',
  description: '',
  color: '#E6EDDF',
  icon: '▤',
  isSilenced: false,
  silencedUntil: null,
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: null,
};
function card(id: string, front: string, back: string): Card {
  return {
    id,
    ownerId: deck.ownerId,
    deckId: deck.id,
    front,
    back,
    hint: 'A nineteenth-century English novelist.',
    explanation: '',
    tags: [],
    aiGenerated: false,
    schedule: initialSchedule(timestamp),
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}
const first = card(
  'c0000000-0000-4000-8000-000000000000',
  'Who wrote Pride and Prejudice?',
  'Jane Austen.',
);
const second = card(
  'd0000000-0000-4000-8000-000000000000',
  'Who wrote Jane Eyre?',
  'Charlotte Brontë.',
);
let renderer: ReactTestRenderer | null = null;
async function mount() {
  await act(async () => {
    renderer = create(React.createElement(ReviewScreen));
  });
}
function button(title: string | RegExp) {
  const result = renderer!.root
    .findAllByType(Button)
    .find((node) =>
      typeof title === 'string' ? node.props.title === title : title.test(node.props.title),
    );
  expect(result, 'Expected an action titled ' + title).toBeDefined();
  return result!;
}
async function press(title: string | RegExp) {
  await act(async () => {
    button(title).props.onPress();
  });
}
function footer(): ReactTestInstance {
  return renderer!.root
    .findAllByType('safe-area')
    .find((node) => node.props.edges.includes('bottom'))!;
}
function text() {
  return renderer!.root
    .findAllByType('text')
    .flatMap((node) => node.children)
    .join(' ')
    .replace(/\s+/g, ' ');
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(timestamp));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  rig.params = { deckId: deck.id };
  rig.data = { decks: [deck], cards: [first, second], reviews: [], pending: 0, issues: [] };
  rig.rate.mockResolvedValue(undefined);
  rig.mutate.mockImplementation(async (work) =>
    work({ rateCard: rig.rate } as unknown as Repository),
  );
});
afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('practice reveals and advances without saving a rating or changing the schedule', async () => {
  rig.params.practice = 'true';
  await mount();
  expect(
    footer()
      .findAllByType(Button)
      .map((node) => node.props.title),
  ).toEqual(['Reveal answer']);
  await press('Reveal answer');
  expect(text()).toContain('Jane Austen.');
  await press('Next card  →');
  expect(text()).toContain(second.front);
  expect(text()).not.toContain(first.back);
  expect(
    footer()
      .findAllByType(Button)
      .map((node) => node.props.title),
  ).toEqual(['Reveal answer']);
  await press('Reveal answer');
  await press('Finish practice');
  expect(text()).toContain('PRACTICE COMPLETE');
  expect(rig.mutate).not.toHaveBeenCalled();
  expect(rig.rate).not.toHaveBeenCalled();
  expect(rig.data!.cards.map((item) => item.schedule)).toEqual([
    first.schedule,
    second.schedule,
  ]);
  expect(rig.scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
});

it('scheduled Good saves once, disables all ratings while saving, and advances to a new question', async () => {
  let finish!: () => void;
  rig.rate.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await mount();
  await press('Reveal answer');
  vi.setSystemTime(new Date(Date.parse(timestamp) + 5000));
  await press(/^Good · /);
  expect(rig.mutate).toHaveBeenCalledTimes(1);
  expect(rig.rate).toHaveBeenCalledExactlyOnceWith(first.id, 'good', 5000);
  expect(
    footer()
      .findAllByType(Button)
      .every((node) => node.props.disabled),
  ).toBe(true);
  await press(/^Good · /);
  expect(rig.rate).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish();
  });
  expect(text()).toContain('Card 2 of 2');
  expect(text()).toContain(second.front);
  expect(text()).not.toContain(second.back);
  expect(
    footer()
      .findAllByType(Button)
      .map((node) => node.props.title),
  ).toEqual(['Reveal answer']);
});

it('keeps reveal and rating actions outside scroll content and preserves the answer across a library rerender', async () => {
  await mount();
  const scroll = renderer!.root.findByType('scroll');
  expect(scroll.findAllByType(Button).map((node) => node.props.title)).not.toContain(
    'Reveal answer',
  );
  expect(
    footer()
      .findAllByType(Button)
      .map((node) => node.props.title),
  ).toEqual(['Reveal answer']);
  await press('Reveal answer');
  rig.data = {
    ...structuredClone(rig.data!),
    cards: [
      ...structuredClone(rig.data!.cards),
      card(
        'e0000000-0000-4000-8000-000000000000',
        'A newly synchronized question',
        'New answer',
      ),
    ],
  };
  await act(async () => {
    renderer!.update(React.createElement(ReviewScreen));
  });
  expect(text()).toContain(first.back);
  expect(text()).toContain('Card 1 of 2');
  expect(
    footer()
      .findAllByType(Button)
      .map((node) => node.props.title),
  ).toEqual(['Again · 1m', 'Hard · 1m', 'Good · 10m', 'Easy · 4d']);
  expect(renderer!.root.findByType('scroll').findAllByType(Button)).toHaveLength(0);
  expect(rig.mutate).not.toHaveBeenCalled();
});

it('a failed save keeps the current answer and makes ratings available to retry', async () => {
  rig.rate.mockRejectedValueOnce(new Error('Storage is full'));
  await mount();
  await press('Reveal answer');
  await press(/^Good · /);
  expect(rig.alert).toHaveBeenCalledWith('Could not finish', 'Storage is full');
  expect(text()).toContain('Card 1 of 2');
  expect(text()).toContain(first.back);
  expect(
    footer()
      .findAllByType(Button)
      .every((node) => !node.props.disabled),
  ).toBe(true);
});
