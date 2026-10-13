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
  syncState: 'idle' as 'idle' | 'syncing' | 'offline',
}));
vi.mock('../src/store', () => ({
  useStore: () => ({
    data: rig.data,
    mutate: rig.mutate,
    syncState: rig.syncState,
    sync: vi.fn(),
  }),
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
import { Button, Screen } from '../src/ui';

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
  rig.syncState = 'idle';
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
  ).toEqual(['Not sure', 'I know it']);
  expect(text()).not.toContain(first.back);
  await press('I know it');
  expect(text()).toContain('Jane Austen.');
  await press('Next card  →');
  expect(text()).toContain(second.front);
  expect(text()).not.toContain(first.back);
  expect(
    footer()
      .findAllByType(Button)
      .map((node) => node.props.title),
  ).toEqual(['Not sure', 'I know it']);
  await press('Not sure');
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
  await press('I know it');
  vi.setSystemTime(new Date(Date.parse(timestamp) + 5000));
  await press(/^Good · /);
  expect(rig.mutate).toHaveBeenCalledTimes(1);
  expect(rig.rate).toHaveBeenCalledExactlyOnceWith(first.id, 'good', 5000);
  expect(text()).toContain('How well did you remember?');
  expect(text()).not.toContain('Saving your review');
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
  ).toEqual(['Not sure', 'I know it']);
});

it('keeps confidence and rating actions outside scroll content and preserves the answer and choice across a library rerender', async () => {
  await mount();
  const scroll = renderer!.root.findByType('scroll');
  expect(scroll.findAllByType(Button).map((node) => node.props.title)).not.toContain(
    'I know it',
  );
  expect(
    footer()
      .findAllByType(Button)
      .map((node) => node.props.title),
  ).toEqual(['Not sure', 'I know it']);
  await press('I know it');
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
  ).toEqual(['Good · 10m', 'Easy · 4d', 'Change choice']);
  expect(renderer!.root.findByType('scroll').findAllByType(Button)).toHaveLength(0);
  expect(rig.mutate).not.toHaveBeenCalled();
});

it('a failed save keeps the current answer and makes ratings available to retry', async () => {
  rig.rate.mockRejectedValueOnce(new Error('Storage is full'));
  await mount();
  await press('I know it');
  await press(/^Good · /);
  expect(rig.alert).toHaveBeenCalledWith('Could not finish', 'Storage is full');
  expect(text()).toContain('Card 1 of 2');
  expect(text()).toContain(first.back);
  expect(
    footer()
      .findAllByType(Button)
      .every((node) => !node.props.disabled),
  ).toBe(true);
  expect(footer().findAllByType(Button).map((node) => node.props.title)).toEqual([
    'Good · 10m',
    'Easy · 4d',
    'Change choice',
  ]);
  await press(/^Good · /);
  expect(rig.rate).toHaveBeenCalledTimes(2);
  expect(text()).toContain('Card 2 of 2');
});

it('saving ratings and synchronizing never inserts routine feedback into the next card or completion', async () => {
  rig.mutate.mockImplementation(async (work) => {
    await work({ rateCard: rig.rate } as unknown as Repository);
    rig.data = { ...rig.data!, pending: rig.data!.pending + 1 };
  });
  await mount();
  await press('I know it');
  await press(/^Good · /);
  expect(rig.rate).toHaveBeenCalledTimes(1);
  expect(rig.data!.pending).toBe(1);
  expect(text()).toContain(second.front);
  const nextCard = text();
  for (const state of ['syncing', 'idle'] as const) {
    rig.syncState = state;
    rig.data = { ...rig.data!, pending: state === 'syncing' ? 1 : 0 };
    await act(async () => renderer!.update(React.createElement(ReviewScreen)));
    expect(text()).toBe(nextCard);
    expect(
      renderer!.root
        .findAllByType('pressable')
        .some((node) => node.props.accessibilityLabel === 'Synchronize library'),
    ).toBe(false);
  }
  await press('I know it');
  await press(/^Good · /);
  expect(rig.rate).toHaveBeenCalledTimes(2);
  expect(rig.data!.pending).toBe(1);
  expect(text()).toContain('SESSION COMPLETE');
  expect(text()).not.toContain('changes saved on this device');
  const completion = text();
  rig.data = { ...rig.data!, pending: 0 };
  await act(async () => renderer!.update(React.createElement(ReviewScreen)));
  expect(text()).toBe(completion);
});

it('keeps practice quiet during background synchronization without saving ratings', async () => {
  rig.params.practice = 'true';
  rig.data = { ...rig.data!, pending: 1 };
  rig.syncState = 'syncing';
  await mount();
  expect(text()).not.toContain('Synchronizing your library');
  await press('I know it');
  const answer = text();
  rig.syncState = 'idle';
  rig.data = { ...rig.data!, pending: 0 };
  await act(async () => renderer!.update(React.createElement(ReviewScreen)));
  expect(text()).toBe(answer);
  expect(rig.mutate).not.toHaveBeenCalled();
});

it('still reports offline status during review and pending changes outside the session', async () => {
  rig.syncState = 'offline';
  rig.data = { ...rig.data!, pending: 1 };
  await mount();
  expect(text()).toContain('Offline · your library is available');
  rig.syncState = 'idle';
  await act(async () => renderer!.update(React.createElement(Screen, { children: null })));
  expect(text()).toContain('1 changes saved on this device');
});

it.each([
  { choice: 'Not sure', rating: 'again', options: ['Again · 1m', 'Hard · 1m'] },
  { choice: 'Not sure', rating: 'hard', options: ['Again · 1m', 'Hard · 1m'] },
  { choice: 'I know it', rating: 'good', options: ['Good · 10m', 'Easy · 4d'] },
  { choice: 'I know it', rating: 'easy', options: ['Good · 10m', 'Easy · 4d'] },
] as const)(
  '$choice offers the matching options and saves $rating only when selected',
  async ({ choice, rating, options }) => {
    await mount();
    await press(choice);
    expect(text()).toContain(first.back);
    expect(
      footer()
        .findAllByType(Button)
        .map((node) => node.props.title),
    ).toEqual([...options, 'Change choice']);
    expect(rig.mutate).not.toHaveBeenCalled();
    await press(options[rating === 'again' || rating === 'good' ? 0 : 1]);
    expect(rig.rate).toHaveBeenCalledExactlyOnceWith(first.id, rating, 0);
    expect(text()).toContain(second.front);
    expect(text()).not.toContain(first.back);
    expect(text()).not.toContain(second.back);
    expect(
      footer()
        .findAllByType(Button)
        .map((node) => node.props.title),
    ).toEqual(['Not sure', 'I know it']);
  },
);

it('lets you change confidence after seeing the answer without saving or hiding it', async () => {
  await mount();
  await press('I know it');
  await press('Change choice');
  expect(text()).toContain(first.back);
  expect(
    footer()
      .findAllByType(Button)
      .map((node) => node.props.title),
  ).toEqual(['Not sure', 'I know it']);
  await press('Not sure');
  expect(text()).toContain(first.back);
  expect(
    footer()
      .findAllByType(Button)
      .map((node) => node.props.title),
  ).toEqual(['Again · 1m', 'Hard · 1m', 'Change choice']);
  expect(rig.mutate).not.toHaveBeenCalled();
  await press(/^Hard · /);
  expect(rig.rate).toHaveBeenCalledExactlyOnceWith(first.id, 'hard', 0);
});

it('can revisit an uncertain card at the end of practice without changing the review schedule', async () => {
  rig.params.practice = 'true';
  await mount();
  await press('Not sure');
  expect(text()).toContain(first.back);
  expect(
    footer()
      .findAllByType(Button)
      .map((node) => node.props.title),
  ).toEqual(['Practice again later', 'Next card  →', 'Change choice']);
  await press('Practice again later');
  expect(text()).toContain('Card 2 of 3');
  expect(text()).toContain(second.front);
  expect(text()).not.toContain(second.back);
  await press('I know it');
  expect(
    footer()
      .findAllByType(Button)
      .map((node) => node.props.title),
  ).toEqual(['Next card  →', 'Change choice']);
  await press('Next card  →');
  expect(text()).toContain('Card 3 of 3');
  expect(text()).toContain(first.front);
  expect(text()).not.toContain(first.back);
  await press('I know it');
  await press('Finish practice');
  expect(text()).toContain('PRACTICE COMPLETE');
  expect(rig.mutate).not.toHaveBeenCalled();
  expect(rig.rate).not.toHaveBeenCalled();
  expect(rig.data!.cards.map((item) => item.schedule)).toEqual([first.schedule, second.schedule]);
});

it('can practice the last card again with its answer and confidence reset', async () => {
  rig.params.practice = 'true';
  rig.data = { ...rig.data!, cards: [first] };
  await mount();
  await press('Not sure');
  await press('Practice again later');
  expect(text()).toContain('Card 2 of 2');
  expect(text()).toContain(first.front);
  expect(text()).not.toContain(first.back);
  expect(
    footer()
      .findAllByType(Button)
      .map((node) => node.props.title),
  ).toEqual(['Not sure', 'I know it']);
  await press('I know it');
  await press('Finish practice');
  expect(text()).toContain('PRACTICE COMPLETE');
  expect(rig.mutate).not.toHaveBeenCalled();
});
