import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildRecallInsights, type RecallInsights } from '@recollect/contracts';

const rig = vi.hoisted(() => ({
  owner: '00000000-0000-4000-8000-000000000001' as string | null,
  params: { friendId: '00000000-0000-4000-8000-000000000002', name: 'Jordan' } as {
    friendId?: string;
    shareId?: string;
    userId?: string;
    name?: string;
  },
  request: vi.fn(),
  rendered: [] as string[],
  focused: true,
}));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => rig.params,
  useFocusEffect: (callback: React.EffectCallback) =>
    React.useEffect(() => (rig.focused ? callback() : undefined), [callback, rig.focused]),
  router: { back: vi.fn(), push: vi.fn() },
}));
vi.mock('react-native', () => ({ ActivityIndicator: () => React.createElement('spinner') }));
vi.mock('../src/store', () => ({
  useStore: () => ({
    session: rig.owner ? { user: { id: rig.owner } } : null,
    data: { decks: [], cards: [], reviews: [], pending: 0, issues: [] },
  }),
}));
vi.mock('../src/api', () => ({ api: { request: rig.request } }));
vi.mock('../src/brand-patterns', () => ({ BrandPattern: () => null }));
vi.mock('../src/personal-insights', () => ({ personalInsights: vi.fn() }));
vi.mock('../src/ui', () => ({
  Screen: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('screen', props, children),
  Panel: ({ children }: { children: React.ReactNode }) =>
    React.createElement('panel', {}, children),
  Text: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('text', props, children),
  Button: (props: object) => React.createElement('button', props),
  Back: (props: object) => React.createElement('back', props),
  Empty: (props: object) => React.createElement('empty', props),
  colors: {},
  s: {},
}));
vi.mock('../src/insight-panels', () => ({
  InsightRange: (props: object) => React.createElement('range', props),
  InsightSummary: ({ insights }: { insights: RecallInsights }) => {
    rig.rendered.push(insights.cards[0]?.front ?? 'empty');
    return React.createElement('summary', { insights });
  },
  InsightCards: () => null,
  InsightCardHistory: () => null,
}));
import InsightsScreen from '../app/insights';

let renderer: ReactTestRenderer | null = null;
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<unknown>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function report(label: string): RecallInsights {
  return buildRecallInsights({
    cards: [
      {
        id: '00000000-0000-4000-8000-000000000010',
        deckId: '00000000-0000-4000-8000-000000000011',
        deckName: 'Shared Italian',
        front: label,
        back: 'Private response history',
      },
    ],
    reviews: [],
    days: 30,
    now: '2026-10-22T12:00:00.000Z',
  });
}
async function mount() {
  await act(async () => {
    renderer = create(React.createElement(InsightsScreen));
  });
}
async function update() {
  await act(async () => {
    renderer!.update(React.createElement(InsightsScreen));
  });
}
function summaries() {
  return renderer!.root.findAllByType('summary');
}
function body() {
  return renderer!.root
    .findAllByType('text')
    .flatMap((node) => node.children)
    .join(' ');
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  rig.owner = '00000000-0000-4000-8000-000000000001';
  rig.params = { friendId: '00000000-0000-4000-8000-000000000002', name: 'Jordan' };
  rig.request.mockReset();
  rig.rendered = [];
  rig.focused = true;
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

it('never renders an old account or scope result while changing owners, including late responses', async () => {
  const first = deferred();
  const second = deferred();
  const third = deferred();
  rig.request
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockReturnValueOnce(third.promise);
  await mount();
  rig.owner = '00000000-0000-4000-8000-000000000003';
  await update();
  expect(rig.request.mock.calls[1]![1]).toEqual({ ownerId: rig.owner });
  await act(async () => first.resolve(report('Old account secret')));
  expect(summaries()).toHaveLength(0);
  expect(rig.rendered).not.toContain('Old account secret');
  await act(async () => second.resolve(report('Current account history')));
  expect(summaries()).toHaveLength(1);
  rig.rendered = [];
  rig.params = {
    shareId: '00000000-0000-4000-8000-000000000004',
    userId: rig.owner,
    name: 'Other friend',
  };
  await update();
  expect(summaries()).toHaveLength(0);
  expect(rig.rendered).not.toContain('Current account history');
  await act(async () => third.resolve(report('New shared scope')));
  expect(rig.rendered).toEqual(['New shared scope']);
  rig.rendered = [];
  rig.owner = null;
  await update();
  expect(summaries()).toHaveLength(0);
  expect(rig.rendered).toEqual([]);
});

it('hides the previous range immediately and ignores an older range’s late permission error', async () => {
  const initial = deferred();
  const seven = deferred();
  const ninety = deferred();
  rig.request
    .mockReturnValueOnce(initial.promise)
    .mockReturnValueOnce(seven.promise)
    .mockReturnValueOnce(ninety.promise);
  await mount();
  await act(async () => initial.resolve(report('Thirty-day result')));
  rig.rendered = [];
  await act(async () => renderer!.root.findByType('range').props.onChange(7));
  expect(summaries()).toHaveLength(0);
  expect(rig.rendered).toEqual([]);
  expect(rig.request.mock.calls[1]![0]).toContain('days=7&');
  await act(async () => renderer!.root.findByType('range').props.onChange(90));
  await act(async () => seven.reject(new Error('Old seven-day permission error')));
  expect(body()).not.toContain('Old seven-day permission error');
  expect(summaries()).toHaveLength(0);
  await act(async () => ninety.resolve(report('Ninety-day result')));
  expect(rig.rendered).toEqual(['Ninety-day result']);
});

it('clears cached shared content on refresh, surfaces revocation and does not carry its error into another account', async () => {
  const initial = deferred();
  const refresh = deferred();
  const other = deferred();
  rig.request
    .mockReturnValueOnce(initial.promise)
    .mockReturnValueOnce(refresh.promise)
    .mockReturnValueOnce(other.promise);
  await mount();
  await act(async () => initial.resolve(report('Previously permitted history')));
  rig.rendered = [];
  await act(async () =>
    renderer!.root
      .findAllByType('button')
      .find((button) => button.props.title === 'Refresh shared insights')!
      .props.onPress(),
  );
  expect(summaries()).toHaveLength(0);
  expect(rig.rendered).toEqual([]);
  await act(async () => refresh.reject(new Error('Detailed progress permission was removed.')));
  expect(body()).toContain('Detailed progress permission was removed.');
  expect(body()).not.toContain('Previously permitted history');
  rig.owner = '00000000-0000-4000-8000-000000000005';
  await update();
  expect(body()).not.toContain('Detailed progress permission was removed.');
  await act(async () => other.resolve(report('Other account permitted history')));
  expect(summaries()).toHaveLength(1);
});

it('discards requests completed after the shared insight screen loses focus', async () => {
  const request = deferred();
  rig.request.mockReturnValueOnce(request.promise);
  await mount();
  rig.focused = false;
  await update();
  await act(async () => request.resolve(report('Off-screen sensitive result')));
  expect(summaries()).toHaveLength(0);
  expect(rig.rendered).toEqual([]);
});
