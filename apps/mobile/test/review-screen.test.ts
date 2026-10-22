import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
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
    ScrollView: React.forwardRef(({ children, ...props }: { children?: React.ReactNode }, ref) => {
      React.useImperativeHandle(ref, () => ({ scrollTo: rig.scrollTo }));
      return React.createElement('scroll', props, children);
    }),
    ActivityIndicator: host('spinner'),
    Image: host('image'),
    StatusBar: host('status-bar'),
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(true),
      addEventListener: () => ({ remove: vi.fn() }),
    },
    Animated: {
      View: host('animated-view'),
      Value: class {
        setValue() {}
        stopAnimation() {}
        interpolate() {
          return 0;
        }
      },
      spring: () => ({ start() {}, stop() {} }),
      timing: () => ({ start() {}, stop() {} }),
    },
    PanResponder: { create: (handlers: unknown) => ({ panHandlers: handlers }) },
    Alert: { alert: rig.alert },
    Platform: { OS: 'ios' },
    StyleSheet: {
      create: <T>(styles: T) => styles,
      flatten: (styles: unknown) =>
        Array.isArray(styles)
          ? Object.assign({}, ...styles.flat(Infinity).filter(Boolean))
          : styles,
    },
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

function cardView() {
  return renderer!.root.findByProps({ testID: 'review-card' }).findByType('pressable');
}
function gestureView() {
  return renderer!.root.findByType('animated-view');
}
async function flip() {
  await act(async () => cardView().props.onPress());
}
async function swipe(dx: number, dy = 0, vx = 0) {
  const gesture = gestureView();
  await act(async () => {
    gesture.props.onPanResponderGrant();
    gesture.props.onPanResponderMove(null, { dx, dy, vx, numberActiveTouches: 1 });
    gesture.props.onPanResponderRelease(null, { dx, dy, vx });
  });
}
function actions() {
  return footer()
    .findAllByType(Button)
    .map((node) => node.props.title);
}

it('tapping flips both ways without recording an answer or advancing', async () => {
  await mount();
  expect(text()).toContain(first.front);
  expect(text()).not.toContain(first.back);
  expect(actions()).toEqual(['← Not sure', 'I remember →']);
  expect(text()).toContain('Not sure: 3d');
  expect(text()).toContain('Remembered: 7d');
  await flip();
  expect(text()).toContain(first.back);
  expect(text()).not.toContain(first.front);
  await flip();
  expect(text()).toContain(first.front);
  expect(text()).not.toContain(first.back);
  expect(rig.mutate).not.toHaveBeenCalled();
});

it.each([
  { dx: 140, rating: 'good' },
  { dx: -140, rating: 'again' },
] as const)(
  'a swipe of $dx saves $rating exactly once and shows the next question',
  async ({ dx, rating }) => {
    await mount();
    vi.setSystemTime(new Date(Date.parse(timestamp) + 5000));
    await swipe(dx);
    expect(rig.rate).toHaveBeenCalledExactlyOnceWith(first.id, rating, 5000);
    expect(text()).toContain(second.front);
    expect(text()).not.toContain(first.back);
    expect(text()).not.toContain(second.back);
    expect(rig.scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  },
);

it('can swipe from the answer side and resets the next card to its question', async () => {
  await mount();
  await flip();
  await swipe(-150);
  expect(rig.rate).toHaveBeenCalledExactlyOnceWith(first.id, 'again', 0);
  expect(text()).toContain(second.front);
  expect(text()).not.toContain(second.back);
});

it('small, vertical and cancelled drags never save or flip', async () => {
  await mount();
  const gesture = gestureView();
  expect(
    gesture.props.onMoveShouldSetPanResponder(null, { dx: 40, dy: 0, numberActiveTouches: 1 }),
  ).toBe(true);
  expect(
    gesture.props.onMoveShouldSetPanResponder(null, { dx: 10, dy: 80, numberActiveTouches: 1 }),
  ).toBe(false);
  await swipe(20);
  await swipe(120, 180);
  await act(async () => {
    gestureView().props.onPanResponderGrant();
    gestureView().props.onPanResponderTerminate();
    cardView().props.onPress();
  });
  expect(rig.rate).not.toHaveBeenCalled();
  expect(text()).toContain(first.front);
  expect(text()).not.toContain(first.back);
});

it('blocks duplicate swipes, button presses and flips while saving', async () => {
  let finish!: () => void;
  rig.rate.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await mount();
  await press('I remember →');
  expect(rig.rate).toHaveBeenCalledTimes(1);
  expect(
    footer()
      .findAllByType(Button)
      .every((node) => node.props.disabled),
  ).toBe(true);
  await press('← Not sure');
  await swipe(-160);
  await flip();
  expect(rig.rate).toHaveBeenCalledTimes(1);
  expect(text()).toContain(first.front);
  expect(text()).not.toContain(first.back);
  expect(text()).not.toContain('Saving your review');
  await act(async () => finish());
  expect(text()).toContain(second.front);
  expect(
    footer()
      .findAllByType(Button)
      .every((node) => !node.props.disabled),
  ).toBe(true);
});

it.each(['start', 'move'])(
  'does not record a response if another finger joins during %s',
  async (phase) => {
    await mount();
    const gesture = gestureView();
    await act(async () => {
      gesture.props.onPanResponderGrant();
      gesture.props[phase === 'start' ? 'onPanResponderStart' : 'onPanResponderMove'](null, {
        dx: 120,
        dy: 0,
        vx: 0,
        numberActiveTouches: 2,
      });
      gesture.props.onPanResponderRelease(null, { dx: 140, dy: 0, vx: 0 });
    });
    expect(rig.rate).not.toHaveBeenCalled();
    expect(text()).toContain(first.front);
  },
);

it('a failed save preserves the current face and allows a retry', async () => {
  rig.rate.mockRejectedValueOnce(new Error('Storage is full'));
  await mount();
  await flip();
  await swipe(140);
  expect(rig.alert).toHaveBeenCalledWith('Could not finish', 'Storage is full');
  expect(text()).toContain(first.back);
  expect(text()).not.toContain(second.front);
  expect(
    footer()
      .findAllByType(Button)
      .every((node) => !node.props.disabled),
  ).toBe(true);
  await press('I remember →');
  expect(rig.rate).toHaveBeenCalledTimes(2);
  expect(text()).toContain(second.front);
});

it('practice records the same ratings as daily review without repeating missed cards', async () => {
  rig.params.practice = 'true';
  await mount();
  await swipe(-150);
  expect(text()).toContain(second.front);
  expect(rig.rate).toHaveBeenCalledExactlyOnceWith(first.id, 'again', 0);
  await press('I remember →');
  expect(text()).toContain('PRACTICE COMPLETE');
  expect(text()).toContain('Your next review dates are saved.');
  expect(rig.rate).toHaveBeenCalledTimes(2);
  expect(rig.rate).toHaveBeenLastCalledWith(second.id, 'good', 0);
});

it('missing the only practice card completes the session instead of immediately repeating it', async () => {
  rig.params.practice = 'true';
  rig.data = { ...rig.data!, cards: [first] };
  await mount();
  await press('Show a hint');
  await flip();
  await swipe(-150);
  expect(text()).toContain('PRACTICE COMPLETE');
  expect(text()).not.toContain(first.front);
  expect(text()).not.toContain(first.back);
  expect(text()).not.toContain(first.hint);
  expect(rig.rate).toHaveBeenCalledExactlyOnceWith(first.id, 'again', 0);
});

it('keeps the flipped face, session queue and position through library synchronization', async () => {
  await mount();
  await flip();
  const before = text();
  rig.data = {
    ...structuredClone(rig.data!),
    pending: 1,
    cards: [
      ...structuredClone(rig.data!.cards),
      card('e0000000-0000-4000-8000-000000000000', 'New question', 'New answer'),
    ],
  };
  for (const state of ['syncing', 'idle'] as const) {
    rig.syncState = state;
    await act(async () => renderer!.update(React.createElement(ReviewScreen)));
    expect(text()).toBe(before);
    expect(text()).toContain(first.back);
  }
  expect(rig.rate).not.toHaveBeenCalled();
});

it('saving never inserts transient sync or saved feedback into the next card or completion', async () => {
  rig.mutate.mockImplementation(async (work) => {
    await work({ rateCard: rig.rate } as unknown as Repository);
    rig.data = { ...rig.data!, pending: rig.data!.pending + 1 };
  });
  await mount();
  await press('I remember →');
  expect(text()).toContain(second.front);
  expect(text()).not.toContain('changes saved on this device');
  rig.syncState = 'syncing';
  await act(async () => renderer!.update(React.createElement(ReviewScreen)));
  expect(text()).not.toContain('Synchronizing your library');
  await press('I remember →');
  expect(text()).toContain('SESSION COMPLETE');
  expect(text()).not.toContain('changes saved on this device');
  expect(rig.rate).toHaveBeenCalledTimes(2);
});

it('accessible card actions use the same scheduling path as swipes', async () => {
  await mount();
  await act(async () =>
    cardView().props.onAccessibilityAction({ nativeEvent: { actionName: 'remembered' } }),
  );
  expect(rig.rate).toHaveBeenCalledExactlyOnceWith(first.id, 'good', 0);
  await act(async () =>
    cardView().props.onAccessibilityAction({ nativeEvent: { actionName: 'missed' } }),
  );
  expect(rig.rate).toHaveBeenLastCalledWith(second.id, 'again', 0);
  expect(text()).toContain('SESSION COMPLETE');
});

it('offline feedback still appears during review and normal sync feedback appears outside review', async () => {
  rig.syncState = 'offline';
  rig.data = { ...rig.data!, pending: 1 };
  await mount();
  expect(text()).toContain('Offline · your library is available');
  rig.syncState = 'idle';
  await act(async () => renderer!.update(React.createElement(Screen, { children: null })));
  expect(text()).toContain('1 changes saved on this device');
});

it('switching review mode starts a fresh session while a normal rerender does not', async () => {
  await mount();
  await flip();
  rig.params = { ...rig.params, practice: 'true' };
  await act(async () => renderer!.update(React.createElement(ReviewScreen)));
  expect(text()).toContain('FREE PRACTICE');
  expect(text()).toContain(first.front);
  expect(text()).not.toContain(first.back);
  expect(rig.rate).not.toHaveBeenCalled();
});
