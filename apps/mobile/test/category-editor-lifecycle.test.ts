import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  defaultReviewSettingsInput,
  type Category,
  type ReviewSettings,
} from '@recollect/contracts';
import type { LocalSnapshot } from '../src/repository';

const rig = vi.hoisted(() => ({
  repo: null as any,
  data: null as LocalSnapshot | null,
  params: { id: '' },
  completion: null as Promise<void> | null,
  push: vi.fn(),
  back: vi.fn(),
  dismissTo: vi.fn(),
  error: vi.fn(),
  alert: vi.fn(),
}));
vi.mock('react-native', () => ({
  View: ({ children, ...props }: any) => React.createElement('view', props, children),
  Pressable: ({ children, ...props }: any) => React.createElement('pressable', props, children),
  Alert: { alert: rig.alert },
}));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => rig.params,
  router: { push: rig.push, back: rig.back, dismissTo: rig.dismissTo },
}));
vi.mock('../src/store', () => ({
  useStore: () => ({
    repository: rig.repo,
    data: rig.data,
    mutate: async (work: any) => {
      await work(rig.repo);
      await rig.completion;
    },
  }),
}));
vi.mock('../src/brand-patterns', () => ({
  BrandPattern: () => null,
  DeckArtwork: () => null,
}));
vi.mock('../src/ui', () => {
  const host =
    (name: string) =>
    ({ children, ...props }: any) =>
      React.createElement(name, props, children);
  return {
    Back: host('back'),
    Button: host('button'),
    Field: host('field'),
    Panel: host('panel'),
    Screen: ({ children, action, leading, footer, ...props }: any) =>
      React.createElement('screen', props, leading, action, children, footer),
    Text: host('text'),
    Empty: host('empty'),
    colors: { lilac: '#E3D8F0' },
    s: {},
    reportError: rig.error,
  };
});

import Categories from '../app/categories/index';
import CategoryDetail from '../app/categories/[id]';
import ReviewSettingsScreen from '../app/review-settings';
import { useActionScope } from '../src/use-action-scope';
import { DeckCategoryPicker } from '../src/review-settings-ui';

const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const firstCategory: Category = {
  id: '00000000-0000-4000-8000-000000000003',
  name: 'Jeopardy',
  color: '#E3D8F0',
  reviewEnabled: true,
  cadence: null,
};
const secondCategory: Category = {
  ...firstCategory,
  id: '00000000-0000-4000-8000-000000000004',
  name: 'Italian',
};
let renderer: ReactTestRenderer | null = null;
function settings(): ReviewSettings {
  return {
    ...defaultReviewSettingsInput(owner),
    categories: [firstCategory, secondCategory],
    ownerId: owner,
    version: 1,
    createdAt: '2026-10-29T12:00:00Z',
    updatedAt: '2026-10-29T12:00:00Z',
    deletedAt: null,
  };
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const button = (title: string) =>
  renderer!.root.findAllByType('button').find((node) => node.props.title === title)!;
const field = (label: string) =>
  renderer!.root.findAllByType('field').find((node) => node.props.label === label)!;
async function mount(component: React.ComponentType) {
  await act(async () => {
    renderer = create(React.createElement(component));
  });
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  rig.params = { id: firstCategory.id };
  rig.data = {
    decks: [],
    cards: [],
    reviews: [],
    pending: 0,
    issues: [],
    reviewSettings: settings(),
  };
  rig.repo = {
    ownerId: owner,
    newId: () => '00000000-0000-4000-8000-000000000005',
    snapshot: vi.fn(async () => rig.data),
    saveReviewSettings: vi.fn(async () => {}),
    saveCategory: vi.fn(async () => {}),
    removeCategory: vi.fn(async () => {}),
    setDeckCategory: vi.fn(async () => {}),
  };
  rig.completion = null;
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

it('invalidates action tokens and old callbacks across an A to B to A owner transition', async () => {
  let capture!: ReturnType<typeof useActionScope>;
  function Probe({ account }: { account: string }) {
    capture = useActionScope(account);
    return null;
  }
  await act(async () => {
    renderer = create(React.createElement(Probe, { account: owner }));
  });
  const oldCapture = capture;
  const oldAction = capture();
  expect(oldAction()).toBe(true);
  await act(async () => {
    renderer!.update(React.createElement(Probe, { account: other }));
  });
  expect(oldAction()).toBe(false);
  await act(async () => {
    renderer!.update(React.createElement(Probe, { account: owner }));
  });
  expect(oldAction()).toBe(false);
  expect(oldCapture()()).toBe(false);
  const currentAction = capture();
  expect(currentAction()).toBe(true);
  await act(async () => {
    renderer!.unmount();
    renderer = null;
  });
  expect(currentAction()).toBe(false);
});

it('allows new actions after StrictMode effect replay while invalidating the first mount token', async () => {
  let capture!: ReturnType<typeof useActionScope>;
  const mountedActions: Array<() => boolean> = [];
  function Probe() {
    capture = useActionScope(owner);
    React.useEffect(() => {
      mountedActions.push(capture());
    }, [capture]);
    return null;
  }
  await act(async () => {
    renderer = create(React.createElement(React.StrictMode, null, React.createElement(Probe)));
  });
  expect(mountedActions).toHaveLength(2);
  expect(mountedActions[0]!()).toBe(false);
  expect(mountedActions[1]!()).toBe(true);
  expect(capture()()).toBe(true);
});

it('does not navigate after an old category creation completes in a different account', async () => {
  const pending = deferred();
  rig.completion = pending.promise;
  await mount(Categories);
  await act(async () => {
    field('Category name').props.onChangeText('Trivia');
  });
  await act(async () => {
    button('Create category').props.onPress();
  });
  expect(rig.repo.saveCategory).toHaveBeenCalledOnce();
  rig.repo = { ...rig.repo, ownerId: other };
  await act(async () => {
    renderer!.update(React.createElement(Categories));
  });
  await act(async () => {
    pending.resolve();
  });
  expect(rig.push).not.toHaveBeenCalled();
  expect(rig.error).not.toHaveBeenCalled();
});

it('keeps a global rules editor usable when only its own synchronization acknowledgement changed metadata', async () => {
  await mount(ReviewSettingsScreen);
  const acknowledged = {
    ...rig.data!.reviewSettings!,
    version: 2,
    updatedAt: '2026-10-29T13:00:00Z',
  };
  rig.data = { ...rig.data!, reviewSettings: acknowledged };
  await act(async () => {
    renderer!.update(React.createElement(ReviewSettingsScreen));
  });
  await act(async () => {
    button('Save review rules').props.onPress();
  });
  expect(rig.repo.saveReviewSettings).toHaveBeenCalledWith(
    expect.objectContaining({ categories: [firstCategory, secondCategory] }),
    acknowledged,
  );
  expect(rig.back).toHaveBeenCalledOnce();
  expect(rig.error).not.toHaveBeenCalled();
});

it('requires reopening global rules when another change altered their content', async () => {
  await mount(ReviewSettingsScreen);
  rig.data = {
    ...rig.data!,
    reviewSettings: { ...rig.data!.reviewSettings!, reviewEnabled: false, version: 2 },
  };
  await act(async () => {
    renderer!.update(React.createElement(ReviewSettingsScreen));
  });
  await act(async () => {
    button('Save review rules').props.onPress();
  });
  expect(rig.repo.saveReviewSettings).not.toHaveBeenCalled();
  expect(rig.back).not.toHaveBeenCalled();
  expect(rig.error.mock.calls[0]?.[0].message).toContain('changed while this page was open');
});

it('keeps category settings open through an acknowledgement without treating it as a competing edit', async () => {
  await mount(CategoryDetail);
  await act(async () => {
    button('Settings').props.onPress();
  });
  const acknowledged = {
    ...rig.data!.reviewSettings!,
    version: 2,
    updatedAt: '2026-10-29T13:00:00Z',
  };
  rig.data = { ...rig.data!, reviewSettings: acknowledged };
  await act(async () => {
    renderer!.update(React.createElement(CategoryDetail));
  });
  await act(async () => {
    button('Save category rules').props.onPress();
  });
  expect(rig.repo.saveReviewSettings).toHaveBeenCalledWith(
    expect.objectContaining({ categories: [firstCategory, secondCategory] }),
    acknowledged,
  );
  expect(rig.error).not.toHaveBeenCalled();
});

it.each(['success', 'error'])(
  'suppresses a late global settings %s after leaving its screen',
  async (outcome) => {
    const pending = deferred();
    rig.completion = pending.promise;
    await mount(ReviewSettingsScreen);
    await act(async () => {
      button('Save review rules').props.onPress();
    });
    expect(rig.repo.saveReviewSettings).toHaveBeenCalledOnce();
    await act(async () => {
      renderer!.unmount();
      renderer = null;
    });
    await act(async () => {
      outcome === 'success' ? pending.resolve() : pending.reject(new Error('Late failure'));
    });
    expect(rig.back).not.toHaveBeenCalled();
    expect(rig.error).not.toHaveBeenCalled();
  },
);

it('resets category settings on route change and ignores the previous category deletion alert', async () => {
  await mount(CategoryDetail);
  await act(async () => {
    button('Settings').props.onPress();
  });
  await act(async () => {
    field('Category name').props.onChangeText('Draft trivia name');
  });
  await act(async () => {
    button('Remove category').props.onPress();
  });
  const confirm = rig.alert.mock.calls[0]![2][1].onPress;
  rig.params = { id: secondCategory.id };
  await act(async () => {
    renderer!.update(React.createElement(CategoryDetail));
  });
  expect(renderer!.root.findByType('screen').props.title).toBe('Italian');
  expect(button('Save category rules')).toBeUndefined();
  await act(async () => {
    confirm();
  });
  expect(rig.repo.removeCategory).not.toHaveBeenCalled();
  expect(rig.dismissTo).not.toHaveBeenCalled();
  await act(async () => {
    button('Settings').props.onPress();
  });
  expect(field('Category name').props.value).toBe('Italian');
});

it('does not dismiss a new category route when deletion of the previous category finishes', async () => {
  const pending = deferred();
  rig.completion = pending.promise;
  await mount(CategoryDetail);
  await act(async () => {
    button('Settings').props.onPress();
  });
  await act(async () => {
    button('Remove category').props.onPress();
  });
  await act(async () => {
    rig.alert.mock.calls[0]![2][1].onPress();
  });
  expect(rig.repo.removeCategory).toHaveBeenCalledWith(firstCategory.id);
  rig.params = { id: secondCategory.id };
  await act(async () => {
    renderer!.update(React.createElement(CategoryDetail));
  });
  await act(async () => {
    pending.resolve();
  });
  expect(rig.dismissTo).not.toHaveBeenCalled();
  expect(rig.error).not.toHaveBeenCalled();
});

it('keeps the displayed baseline when remote settings change during editing', async () => {
  await mount(ReviewSettingsScreen);
  rig.data = {
    ...rig.data!,
    reviewSettings: { ...rig.data!.reviewSettings!, version: 2, reviewEnabled: false },
  };
  await act(async () => {
    renderer!.update(React.createElement(ReviewSettingsScreen));
  });
  await act(async () => {
    button('Save review rules').props.onPress();
  });
  expect(rig.repo.saveReviewSettings).not.toHaveBeenCalled();
  expect(rig.error.mock.calls[0]![0].message).toContain('changed while this page was open');
  expect(rig.back).not.toHaveBeenCalled();
});

it('preserves the category editor baseline instead of recreating a remotely removed category', async () => {
  await mount(CategoryDetail);
  await act(async () => {
    button('Settings').props.onPress();
  });
  rig.data = {
    ...rig.data!,
    reviewSettings: { ...rig.data!.reviewSettings!, version: 2, categories: [secondCategory] },
  };
  // The transaction can see deletion before a refreshed snapshot reaches the screen.
  await act(async () => {
    button('Save category rules').props.onPress();
  });
  expect(rig.repo.saveReviewSettings).not.toHaveBeenCalled();
  expect(rig.error.mock.calls[0]![0].message).toContain('categories changed');
});

it('finishes a current-owner global save normally', async () => {
  await mount(ReviewSettingsScreen);
  await act(async () => {
    button('Save review rules').props.onPress();
  });
  expect(rig.repo.saveReviewSettings).toHaveBeenCalledOnce();
  expect(rig.back).toHaveBeenCalledOnce();
  expect(button('Save review rules').props.loading).toBe(false);
});

it('suppresses an assignment failure after its deck picker has unmounted', async () => {
  const pending = deferred();
  rig.completion = pending.promise;
  await mount(() =>
    React.createElement(DeckCategoryPicker, { deckId: '00000000-0000-4000-8000-000000000010' }),
  );
  await act(async () => {
    button('Change').props.onPress();
  });
  const choice = renderer!.root
    .findAllByType('pressable')
    .find((node) => node.props.accessibilityLabel === secondCategory.name)!;
  await act(async () => {
    choice.props.onPress();
  });
  expect(rig.repo.setDeckCategory).toHaveBeenCalledOnce();
  await act(async () => {
    renderer!.unmount();
    renderer = null;
  });
  await act(async () => {
    pending.reject(new Error('Late assignment failure'));
  });
  expect(rig.error).not.toHaveBeenCalled();
});
