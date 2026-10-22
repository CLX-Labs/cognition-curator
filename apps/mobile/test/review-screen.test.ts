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
  haptic: vi.fn<(remembered: boolean) => void>(),
  revealHaptic: vi.fn<() => void>(),
  cancelHaptic: vi.fn<() => void>(),
  setActiveHaptic: vi.fn<(active: boolean) => void>(),
  appState: 'active',
  appStateChange: null as ((state: string) => void) | null,
  removeAppStateListener: vi.fn(),
  focusEffect: null as (() => void | (() => void)) | null,
  blur: null as (() => void) | null,
  reduceMotion: true,
  timing: vi.fn(),
  syncState: 'idle' as 'idle' | 'syncing' | 'offline',
}));
vi.mock('../src/review-haptics', () => ({
  createReviewHaptics: () => ({
    answer: rig.haptic,
    reveal: rig.revealHaptic,
    cancel: rig.cancelHaptic,
    setActive: rig.setActiveHaptic,
  }),
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
  useFocusEffect: (effect: () => void | (() => void)) => {
    React.useEffect(() => {
      rig.focusEffect = effect;
      const cleanup = effect();
      rig.blur = typeof cleanup === 'function' ? cleanup : null;
      return cleanup;
    }, [effect]);
  },
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
    AppState: {
      get currentState() {
        return rig.appState;
      },
      addEventListener: (_event: string, listener: (state: string) => void) => {
        rig.appStateChange = listener;
        return { remove: rig.removeAppStateListener };
      },
    },
    Modal: host('modal'),
    useWindowDimensions: () => ({ width: 375, height: 667, scale: 2, fontScale: 1 }),
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(rig.reduceMotion),
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
      timing: rig.timing,
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
  rig.appState = 'active';
  rig.appStateChange = null;
  rig.focusEffect = null;
  rig.blur = null;
  rig.reduceMotion = true;
  rig.timing.mockImplementation(() => ({ start() {}, stop() {} }));
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
  return renderer!.root.findByProps({ testID: 'review-gesture' }).findByType('animated-view');
}
function feedback() {
  return renderer!.root.findAll(
    (node) => typeof node.type === 'string' && node.props.testID === 'review-feedback',
  );
}
async function elapse(milliseconds: number) {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
  });
}
async function flip() {
  await act(async () => cardView().props.onPress());
}
function reader() {
  return renderer!.root.findByProps({ testID: 'review-reader' }).findByType('modal');
}
function readingText() {
  return reader().findByProps({ testID: 'review-reader-text' }).findByType('text');
}
async function closeReader() {
  await act(async () =>
    renderer!.root
      .findByProps({ testID: 'review-reader-close' })
      .findByType('pressable')
      .props.onPress(),
  );
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

it.each([false, true])(
  'keeps active review fixed and restores scrolling after the swipe session ends (practice=%s)',
  async (practice) => {
    if (practice) rig.params.practice = 'true';
    await mount();
    expect(renderer!.root.findAllByType('scroll')).toHaveLength(0);
    await swipe(140);
    expect(renderer!.root.findAllByType('scroll')).toHaveLength(0);
    expect(text()).toContain(second.front);
    await swipe(-140);
    expect(text()).toContain(practice ? 'PRACTICE COMPLETE' : 'SESSION COMPLETE');
    expect(renderer!.root.findAllByType('scroll')).toHaveLength(1);
    expect(
      renderer!.root.findAll(
        (node) => typeof node.type === 'string' && node.props.testID === 'review-gesture',
      ),
    ).toHaveLength(0);
    expect(rig.scrollTo).not.toHaveBeenCalled();
  },
);

it('preserves scrolling for ordinary screens', async () => {
  await act(async () => {
    renderer = create(
      React.createElement(Screen, { title: 'Your library', children: 'Library content' }),
    );
  });
  expect(renderer!.root.findAllByType('scroll')).toHaveLength(1);
  expect(text()).toContain('Your library');
});

it.each([false, true])(
  'opens the full current face in a separate reader and returns to that face (revealed=%s)',
  async (revealed) => {
    await mount();
    if (revealed) await flip();
    rig.revealHaptic.mockClear();
    await press('Read in full');
    expect(readingText().children.join('')).toBe(revealed ? first.back : first.front);
    expect(renderer!.root.findAllByType('scroll')).toHaveLength(1);
    expect(cardView().props.disabled).toBe(true);
    expect(
      footer()
        .findAllByType(Button)
        .every((node) => node.props.disabled),
    ).toBe(true);
    await swipe(140);
    await press('I remember →');
    await flip();
    expect(rig.rate).not.toHaveBeenCalled();
    expect(rig.haptic).not.toHaveBeenCalled();
    expect(rig.revealHaptic).not.toHaveBeenCalled();
    expect(feedback()).toHaveLength(0);
    await closeReader();
    expect(renderer!.root.findAllByType('modal')).toHaveLength(0);
    expect(renderer!.root.findAllByType('scroll')).toHaveLength(0);
    expect(cardView().props.disabled).toBe(false);
    expect(cardView().props.accessibilityLabel).toContain(revealed ? first.back : first.front);
    await swipe(-140);
    expect(rig.rate).toHaveBeenCalledExactlyOnceWith(first.id, 'again', 0);
    expect(text()).toContain(second.front);
  },
);

it('keeps long answers and context readable without adding a scroll view to the swipe surface', async () => {
  const back = 'A long answer with all of its original details. '.repeat(80);
  const explanation = 'The wider context remains available in full. '.repeat(80);
  rig.data = { ...rig.data!, cards: [{ ...first, back, explanation }, second] };
  await mount();
  await flip();
  expect(cardView().props.accessibilityLabel).toBe('Answer: ' + back);
  expect(renderer!.root.findAllByType('scroll')).toHaveLength(0);
  await press('Read in full');
  expect(readingText().children.join('')).toBe(back);
  expect(readingText().props.numberOfLines).toBeUndefined();
  await closeReader();
  await press('More context');
  expect(readingText().children.join('')).toBe(explanation);
  expect(readingText().props.numberOfLines).toBeUndefined();
  await act(async () => reader().props.onRequestClose());
  expect(renderer!.root.findAllByType('scroll')).toHaveLength(0);
  expect(cardView().props.accessibilityLabel).toBe('Answer: ' + back);
  expect(rig.rate).not.toHaveBeenCalled();
});

it('opens hints outside the swipe surface without flipping or saving the card', async () => {
  await mount();
  await press('Show a hint');
  expect(rig.revealHaptic).toHaveBeenCalledExactlyOnceWith();
  expect(rig.haptic).not.toHaveBeenCalled();
  expect(readingText().children.join('')).toBe(first.hint);
  expect(renderer!.root.findAllByType('scroll')).toHaveLength(1);
  await closeReader();
  expect(renderer!.root.findAllByType('scroll')).toHaveLength(0);
  expect(cardView().props.accessibilityLabel).toBe('Question: ' + first.front);
  expect(rig.rate).not.toHaveBeenCalled();
  expect(rig.revealHaptic).toHaveBeenCalledTimes(1);
  await swipe(140);
  expect(renderer!.root.findAllByType('modal')).toHaveLength(0);
  expect(text()).toContain(second.front);
});

it('tapping to reveal ticks once while flipping back stays silent without rating or advancing', async () => {
  await mount();
  expect(text()).toContain(first.front);
  expect(text()).not.toContain(first.back);
  expect(actions()).toEqual(['← Not sure', 'I remember →']);
  expect(text()).toContain('Not sure: 3d');
  expect(text()).toContain('Remembered: 7d');
  await flip();
  expect(rig.revealHaptic).toHaveBeenCalledExactlyOnceWith();
  expect(text()).toContain(first.back);
  expect(text()).not.toContain(first.front);
  await flip();
  expect(text()).toContain(first.front);
  expect(text()).not.toContain(first.back);
  expect(rig.mutate).not.toHaveBeenCalled();
  expect(rig.haptic).not.toHaveBeenCalled();
  expect(rig.revealHaptic).toHaveBeenCalledTimes(1);
  expect(feedback()).toHaveLength(0);
});

it.each([
  { dx: 140, rating: 'good', remembered: true, cue: '✓ Remembered' },
  { dx: -140, rating: 'again', remembered: false, cue: '↺ Review later' },
] as const)(
  'a swipe of $dx saves $rating once, confirms the outcome and shows the next question',
  async ({ dx, rating, remembered, cue }) => {
    await mount();
    vi.setSystemTime(new Date(Date.parse(timestamp) + 5000));
    await swipe(dx);
    expect(rig.rate).toHaveBeenCalledExactlyOnceWith(first.id, rating, 5000);
    expect(text()).toContain(second.front);
    expect(text()).not.toContain(first.back);
    expect(text()).not.toContain(second.back);
    expect(renderer!.root.findAllByType('scroll')).toHaveLength(0);
    expect(rig.haptic).toHaveBeenCalledExactlyOnceWith(remembered);
    expect(feedback()).toHaveLength(1);
    expect(text()).toContain(cue);
    await elapse(700);
    expect(feedback()).toHaveLength(0);
    expect(text()).toContain(second.front);
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
  expect(rig.haptic).not.toHaveBeenCalled();
  expect(rig.revealHaptic).not.toHaveBeenCalled();
  expect(feedback()).toHaveLength(0);
  expect(text()).toContain(first.front);
  expect(text()).not.toContain(first.back);
});

it.each([
  { direction: 'vertical', dx: 2, dy: 80, numberActiveTouches: 1 },
  { direction: 'diagonal', dx: 70, dy: 70, numberActiveTouches: 1 },
  { direction: 'multiple fingers', dx: 2, dy: 2, numberActiveTouches: 2 },
])(
  'rejects $direction movement without allowing its release to flip the card',
  async ({ direction: _direction, ...movement }) => {
    await mount();
    await act(async () => {
      cardView().props.onPressIn();
      expect(gestureView().props.onMoveShouldSetPanResponderCapture(null, movement)).toBe(false);
      expect(gestureView().props.onMoveShouldSetPanResponder(null, movement)).toBe(false);
      // With no enclosing ScrollView, a rejected drag may still reach Pressable's release.
      cardView().props.onPress();
    });
    expect(text()).toContain(first.front);
    expect(text()).not.toContain(first.back);
    expect(rig.rate).not.toHaveBeenCalled();
    expect(rig.haptic).not.toHaveBeenCalled();
    expect(rig.revealHaptic).not.toHaveBeenCalled();
    expect(feedback()).toHaveLength(0);
    await act(async () => {
      cardView().props.onPressIn();
      cardView().props.onPress();
    });
    expect(text()).toContain(first.back);
    expect(text()).not.toContain(first.front);
    expect(rig.rate).not.toHaveBeenCalled();
    expect(rig.haptic).not.toHaveBeenCalled();
    expect(rig.revealHaptic).toHaveBeenCalledExactlyOnceWith();
  },
);

it('blocks duplicate swipes, button presses and flips while saving', async () => {
  let finish!: () => void;
  rig.rate.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await mount();
  rig.cancelHaptic.mockClear();
  await press('I remember →');
  expect(rig.cancelHaptic).toHaveBeenCalledExactlyOnceWith();
  expect(rig.rate).toHaveBeenCalledTimes(1);
  expect(rig.haptic).not.toHaveBeenCalled();
  expect(rig.revealHaptic).not.toHaveBeenCalled();
  expect(feedback()).toHaveLength(0);
  expect(
    footer()
      .findAllByType(Button)
      .every((node) => node.props.disabled),
  ).toBe(true);
  await press('← Not sure');
  await swipe(-160);
  await flip();
  await press('Show a hint');
  expect(rig.rate).toHaveBeenCalledTimes(1);
  expect(rig.cancelHaptic).toHaveBeenCalledTimes(1);
  expect(rig.haptic).not.toHaveBeenCalled();
  expect(rig.revealHaptic).not.toHaveBeenCalled();
  expect(feedback()).toHaveLength(0);
  expect(text()).toContain(first.front);
  expect(text()).not.toContain(first.back);
  expect(renderer!.root.findAllByType('modal')).toHaveLength(0);
  expect(text()).not.toContain('Saving your review');
  await act(async () => finish());
  expect(text()).toContain(second.front);
  expect(rig.haptic).toHaveBeenCalledExactlyOnceWith(true);
  expect(text()).toContain('✓ Remembered');
  expect(
    footer()
      .findAllByType(Button)
      .every((node) => !node.props.disabled),
  ).toBe(true);
});

it('reading full text and context stay silent, and an open hint cannot replay its reveal tick', async () => {
  rig.data = { ...rig.data!, cards: [{ ...first, explanation: 'The wider context.' }, second] };
  await mount();
  await press('Read in full');
  expect(rig.revealHaptic).not.toHaveBeenCalled();
  expect(rig.cancelHaptic).toHaveBeenCalledExactlyOnceWith();
  await closeReader();
  await press('Show a hint');
  expect(rig.revealHaptic).toHaveBeenCalledExactlyOnceWith();
  await press('Show a hint');
  await flip();
  expect(rig.revealHaptic).toHaveBeenCalledTimes(1);
  expect(readingText().children.join('')).toBe(first.hint);
  await closeReader();
  await flip();
  expect(rig.revealHaptic).toHaveBeenCalledTimes(2);
  await press('More context');
  expect(readingText().children.join('')).toBe('The wider context.');
  await closeReader();
  expect(rig.revealHaptic).toHaveBeenCalledTimes(2);
  expect(rig.haptic).not.toHaveBeenCalled();
  expect(rig.rate).not.toHaveBeenCalled();
});

it('disables feedback when backgrounded or blurred, resumes only when focused, and cleans up on unmount', async () => {
  await mount();
  expect(rig.setActiveHaptic).toHaveBeenLastCalledWith(true);
  await act(async () => rig.appStateChange!('background'));
  expect(rig.setActiveHaptic).toHaveBeenLastCalledWith(false);
  await act(async () => rig.appStateChange!('active'));
  expect(rig.setActiveHaptic).toHaveBeenLastCalledWith(true);
  await act(async () => rig.blur!());
  expect(rig.setActiveHaptic).toHaveBeenLastCalledWith(false);
  await act(async () => {
    rig.appStateChange!('background');
    rig.appStateChange!('active');
  });
  expect(rig.setActiveHaptic).toHaveBeenLastCalledWith(false);
  await act(async () => {
    rig.focusEffect!();
  });
  expect(rig.setActiveHaptic).toHaveBeenLastCalledWith(true);
  await act(async () => renderer!.unmount());
  renderer = null;
  expect(rig.setActiveHaptic).toHaveBeenLastCalledWith(false);
  expect(rig.removeAppStateListener).toHaveBeenCalledExactlyOnceWith();
});

it('keeps feedback disabled when the session first mounts in the background', async () => {
  rig.appState = 'background';
  await mount();
  expect(rig.setActiveHaptic).toHaveBeenLastCalledWith(false);
  await act(async () => rig.appStateChange!('active'));
  expect(rig.setActiveHaptic).toHaveBeenLastCalledWith(true);
  expect(rig.haptic).not.toHaveBeenCalled();
  expect(rig.revealHaptic).not.toHaveBeenCalled();
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
    expect(rig.haptic).not.toHaveBeenCalled();
    expect(rig.revealHaptic).not.toHaveBeenCalled();
    expect(feedback()).toHaveLength(0);
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
  expect(rig.haptic).not.toHaveBeenCalled();
  expect(feedback()).toHaveLength(0);
  expect(
    footer()
      .findAllByType(Button)
      .every((node) => !node.props.disabled),
  ).toBe(true);
  await press('I remember →');
  expect(rig.rate).toHaveBeenCalledTimes(2);
  expect(text()).toContain(second.front);
  expect(rig.haptic).toHaveBeenCalledExactlyOnceWith(true);
  expect(text()).toContain('✓ Remembered');
});

it.each([
  { dx: 140, remembered: true, cue: '✓ Remembered' },
  { dx: -140, remembered: false, cue: '↺ Review later' },
])(
  'keeps the last card’s $cue cue visible on session completion',
  async ({ dx, remembered, cue }) => {
    rig.data = { ...rig.data!, cards: [first] };
    await mount();
    await swipe(dx);
    expect(text()).toContain('SESSION COMPLETE');
    expect(text()).not.toContain(first.front);
    expect(feedback()).toHaveLength(1);
    expect(text()).toContain(cue);
    expect(rig.haptic).toHaveBeenCalledExactlyOnceWith(remembered);
    await elapse(300);
    expect(text()).toContain(cue);
    await elapse(400);
    expect(feedback()).toHaveLength(0);
    expect(text()).toContain('SESSION COMPLETE');
  },
);

it('replaces rapid feedback and gives the latest outcome its own display time', async () => {
  await mount();
  await swipe(140);
  await elapse(300);
  await swipe(-140);
  expect(text()).toContain('SESSION COMPLETE');
  expect(text()).toContain('↺ Review later');
  expect(text()).not.toContain('✓ Remembered');
  expect(feedback()).toHaveLength(1);
  expect(rig.haptic.mock.calls).toEqual([[true], [false]]);
  // The first answer's timeout must not clear the newer answer's cue.
  await elapse(300);
  expect(text()).toContain('↺ Review later');
  await elapse(400);
  expect(feedback()).toHaveLength(0);
});

it.each([true, false])(
  'keeps the cue outside the layout and honors reduce motion=%s',
  async (reduceMotion) => {
    rig.reduceMotion = reduceMotion;
    await mount();
    await swipe(140);
    const badge = feedback()[0]!;
    expect(badge.props.pointerEvents).toBe('none');
    expect(Object.assign({}, ...badge.props.style)).toMatchObject({ position: 'absolute' });
    if (reduceMotion) {
      expect(rig.timing).not.toHaveBeenCalled();
    } else {
      expect(rig.timing).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        expect.objectContaining({ toValue: 0 }),
      );
    }
    expect(text()).toContain(second.front);
  },
);

it('cleans up feedback when leaving a session instead of showing it in the next one', async () => {
  await mount();
  await swipe(140);
  expect(feedback()).toHaveLength(1);
  rig.params = { ...rig.params, practice: 'true' };
  await act(async () => renderer!.update(React.createElement(ReviewScreen)));
  expect(text()).toContain('FREE PRACTICE');
  expect(feedback()).toHaveLength(0);
  await elapse(1000);
  expect(rig.haptic).toHaveBeenCalledTimes(1);
  expect(text()).toContain(first.front);
});

it('does not vibrate for an old session when its save finishes after leaving', async () => {
  let finish!: () => void;
  rig.rate.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await mount();
  await swipe(140);
  expect(rig.rate).toHaveBeenCalledTimes(1);
  rig.params = { ...rig.params, practice: 'true' };
  await act(async () => renderer!.update(React.createElement(ReviewScreen)));
  await act(async () => finish());
  expect(rig.haptic).not.toHaveBeenCalled();
  expect(feedback()).toHaveLength(0);
  expect(text()).toContain('FREE PRACTICE');
  expect(text()).toContain(first.front);
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
  await closeReader();
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

it('saving never inserts sync or storage-status banners into the next card or completion', async () => {
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
  expect(rig.haptic).toHaveBeenCalledExactlyOnceWith(true);
  expect(text()).toContain('✓ Remembered');
  await act(async () =>
    cardView().props.onAccessibilityAction({ nativeEvent: { actionName: 'missed' } }),
  );
  expect(rig.rate).toHaveBeenLastCalledWith(second.id, 'again', 0);
  expect(rig.haptic.mock.calls).toEqual([[true], [false]]);
  expect(text()).toContain('↺ Review later');
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
