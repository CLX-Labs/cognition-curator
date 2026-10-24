import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MarketplaceListing } from '@recollect/contracts';

const rig = vi.hoisted(() => ({
  owner: '00000000-0000-4000-8000-000000000001',
  focused: true,
  request: vi.fn(),
  push: vi.fn(),
  sync: vi.fn(async () => {}),
  refresh: vi.fn(async () => {}),
  repository: null as any,
  data: { decks: [] as any[], cards: [] as any[], reviews: [], pending: 0, issues: [] },
}));
vi.mock('expo-router', () => ({
  useFocusEffect: (callback: React.EffectCallback) =>
    React.useEffect(() => (rig.focused ? callback() : undefined), [callback, rig.focused]),
  useLocalSearchParams: () => ({ id: '00000000-0000-4000-8000-000000000003' }),
  router: { push: rig.push, dismissTo: vi.fn() },
}));
vi.mock('react-native', () => ({
  View: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('view', props, children),
  Pressable: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('pressable', props, children),
  Switch: (props: object) => React.createElement('switch', props),
  Alert: { alert: vi.fn() },
  Linking: { openURL: vi.fn() },
}));
vi.mock('../src/api', () => ({ api: { request: rig.request }, ApiError: class extends Error {} }));
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    (await import('node:crypto')).createHash('sha256').update(value).digest('hex'),
}));
vi.mock('../src/store', () => ({
  useStore: () => ({
    session: { user: { id: rig.owner } },
    repository: rig.repository,
    data: rig.data,
    sync: rig.sync,
    refresh: rig.refresh,
  }),
}));
vi.mock('../src/profile', () => ({ useProfile: () => ({ profile: { name: 'Nico' } }) }));
vi.mock('../src/brand-patterns', () => ({
  BrandPattern: () => null,
  DeckArtwork: (props: object) => React.createElement('deck-art', props),
}));
vi.mock('../src/ui', () => ({
  Screen: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('screen', props, children),
  Panel: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('panel', props, children),
  Text: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('text', props, children),
  Button: (props: object) => React.createElement('button', props),
  Back: (props: object) => React.createElement('back', props),
  Empty: (props: object) => React.createElement('empty', props),
  Field: (props: object) => React.createElement('field', props),
  colors: {},
  s: {},
  reportError: vi.fn(),
}));
import DeckMarketplace from '../src/deck-marketplace';
import MarketplaceDetail from '../app/marketplace/[id]';
import MarketplaceCatalog from '../app/marketplace/index';
import { MarketplaceMetrics } from '../src/marketplace-ui';

let renderer: ReactTestRenderer | null = null;
const deckId = '00000000-0000-4000-8000-000000000002';
const listingId = '00000000-0000-4000-8000-000000000003';
function listing(): MarketplaceListing {
  return {
    id: listingId,
    publisher: { id: '00000000-0000-4000-8000-000000000004', name: 'A learner' },
    sourceDeckId: null,
    deck: { name: 'Alternators', description: 'A useful idea', color: '#343AE7', icon: 'spark' },
    version: 1,
    cardCount: 5,
    isPublished: true,
    showDownloadCount: false,
    showUsageStats: false,
    downloadCount: null,
    usageStats: null,
    publishedAt: '2026-10-23T12:00:00Z',
    updatedAt: '2026-10-23T12:00:00Z',
    download: null,
  };
}
function button(title: string) {
  return renderer!.root.findAllByType('button').find((node) => node.props.title === title)!;
}
function toggle(label: string) {
  return renderer!.root
    .findAllByType('switch')
    .find((node) => node.props.accessibilityLabel === label)!;
}
function body() {
  return renderer!.root
    .findAllByType('text')
    .flatMap((node) => node.children)
    .join(' ');
}
async function press(title: string) {
  await act(async () => {
    await button(title).props.onPress();
  });
}
async function mount(element: React.ReactElement) {
  await act(async () => {
    renderer = create(element);
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  rig.owner = '00000000-0000-4000-8000-000000000001';
  rig.focused = true;
  rig.request.mockReset();
  rig.push.mockReset();
  rig.sync.mockClear();
  rig.refresh.mockClear();
  rig.data = {
    decks: [{ id: deckId, name: 'Alternators' }],
    cards: [{ id: 'card', deckId }],
    reviews: [],
    pending: 0,
    issues: [],
  };
  const saved = new Map<string, unknown>();
  rig.repository = {
    ownerId: rig.owner,
    newId: () => '00000000-0000-4000-8000-000000000005',
    snapshot: async () => rig.data,
    getState: async (key: string) => saved.get(key) ?? null,
    setState: async (key: string, value: unknown) => {
      saved.set(key, value);
    },
  };
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

it('requires a deliberate rights acknowledgement and keeps the publication form after an HTTP error', async () => {
  rig.request.mockImplementation(async (path, options) => {
    if (path === '/v1/marketplace/mine') return { listings: [] };
    if (path === '/v1/marketplace/downloads') return { downloads: [] };
    if (options?.method === 'POST') throw new Error('Connection interrupted');
    throw new Error('Unexpected request');
  });
  await mount(React.createElement(DeckMarketplace, { deckId }));
  expect(rig.request).not.toHaveBeenCalled();
  await act(async () => renderer!.root.findByType('pressable').props.onPress());
  await press('Publish this deck…');
  expect(toggle('Show download count').props.value).toBe(false);
  expect(toggle('Show aggregate practice activity').props.value).toBe(false);
  expect(button('Publish public copy').props.disabled).toBe(true);
  await press('Publish public copy');
  expect(rig.request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(
    0,
  );
  await act(async () =>
    toggle('I have the rights to share this deck and image').props.onValueChange(true),
  );
  await press('Publish public copy');
  expect(body()).toContain('Connection interrupted');
  expect(body()).toContain('every card’s question');
  expect(toggle('I have the rights to share this deck and image').props.value).toBe(true);
  expect(button('Retry saved publication').props.disabled).toBe(false);
  expect(toggle('Show download count').props.disabled).toBe(true);
  expect(body()).toContain('previous publication response was interrupted');
  expect(rig.sync).toHaveBeenCalledWith({ throwOnError: true });
  expect(await rig.repository.getState('marketplace-publication:' + deckId)).toMatchObject({
    deckId,
    rightsAccepted: true,
    showDownloadCount: false,
    showUsageStats: false,
  });
});
it('shows the reviewed image and explicitly includes it in public visibility and rights consent', async () => {
  const photo = 'data:image/jpeg;base64,/9j/2Q==';
  rig.data.decks[0]!.imageDataUrl = photo;
  rig.request.mockImplementation(async (path) => {
    if (path === '/v1/marketplace/mine') return { listings: [] };
    if (path === '/v1/marketplace/downloads') return { downloads: [] };
    throw new Error('Unexpected request');
  });
  await mount(React.createElement(DeckMarketplace, { deckId }));
  await act(async () => renderer!.root.findByType('pressable').props.onPress());
  await press('Publish this deck…');
  expect(renderer!.root.findByType('deck-art').props.imageDataUrl).toBe(photo);
  expect(body()).toContain('deck image');
  expect(body()).toContain('cover image');
  expect(toggle('I have the rights to share this deck and image').props.value).toBe(false);
  expect(button('Publish public copy').props.disabled).toBe(true);
  expect(rig.request.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});

it('does not substitute zero or leak returned metrics when the owner hides either metric', async () => {
  const value = {
    ...listing(),
    downloadCount: 17,
    usageStats: { learnerBand: '5–9', reviewBand: '10–24', recallBand: 'mixed', windowDays: 30 },
  } as MarketplaceListing;
  await mount(React.createElement(MarketplaceMetrics, { listing: value }));
  expect(body()).not.toContain('17');
  expect(body()).not.toContain('5–9');
  expect(body()).not.toContain('downloads');
  await act(async () =>
    renderer!.update(
      React.createElement(MarketplaceMetrics, {
        listing: {
          ...value,
          showDownloadCount: true,
          showUsageStats: true,
          downloadCount: null,
          usageStats: null,
        },
      }),
    ),
  );
  expect(body()).not.toContain('0');
  expect(body()).not.toContain('reviews');
});

it('freezes the reviewed publication and requires a new acknowledgement when its cards change', async () => {
  rig.request.mockImplementation(async (path) =>
    path === '/v1/marketplace/mine' ? { listings: [] } : { downloads: [] },
  );
  await mount(React.createElement(DeckMarketplace, { deckId }));
  await act(async () => renderer!.root.findByType('pressable').props.onPress());
  await press('Publish this deck…');
  await act(async () =>
    toggle('I have the rights to share this deck and image').props.onValueChange(true),
  );
  rig.data = {
    ...rig.data,
    decks: rig.data.decks.map((deck) => ({ ...deck, name: 'Unseen remote title' })),
    cards: rig.data.cards.map((card) => ({ ...card, front: 'New remote card' })),
  };
  await act(async () => renderer!.update(React.createElement(DeckMarketplace, { deckId })));
  expect(body()).toContain('Alternators');
  expect(body()).not.toContain('Unseen remote title');
  expect(body()).toContain('changed while you were reviewing');
  expect(button('Publish public copy').props.disabled).toBe(true);
  await press('Publish public copy');
  expect(rig.request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(
    0,
  );
  await press('Review latest cards');
  expect(body()).toContain('Unseen remote title');
  expect(toggle('I have the rights to share this deck and image').props.value).toBe(false);
  expect(button('Publish public copy').props.disabled).toBe(true);
});

it('does not open a publication form after its preparation read finishes off screen', async () => {
  rig.request.mockImplementation(async (path) =>
    path === '/v1/marketplace/mine' ? { listings: [] } : { downloads: [] },
  );
  await mount(React.createElement(DeckMarketplace, { deckId }));
  await act(async () => renderer!.root.findByType('pressable').props.onPress());
  const held = deferred<unknown>();
  rig.repository.getState = () => held.promise;
  await act(async () => {
    button('Publish this deck…').props.onPress();
  });
  rig.focused = false;
  await act(async () => renderer!.update(React.createElement(DeckMarketplace, { deckId })));
  await act(async () => held.resolve(null));
  expect(renderer!.root.findAllByType('switch')).toHaveLength(0);
  expect(body()).not.toContain('Share beyond your circle?');
});

it('preserves a downloaded learner’s contribution control independently of listing visibility', async () => {
  let enabled = true;
  rig.request.mockImplementation(async (path, options) => {
    if (path === '/v1/marketplace/mine') return { listings: [] };
    if (path === '/v1/marketplace/downloads')
      return { downloads: [{ listingId, deckId, version: 1, contributeUsage: enabled }] };
    if (path.endsWith('/usage')) {
      enabled = options.body.enabled;
      return { listingId, deckId, version: 1, contributeUsage: enabled };
    }
    throw new Error('Unexpected request');
  });
  await mount(React.createElement(DeckMarketplace, { deckId }));
  await act(async () => renderer!.root.findByType('pressable').props.onPress());
  expect(toggle('Contribute my practice activity').props.value).toBe(true);
  await act(async () => toggle('Contribute my practice activity').props.onValueChange(false));
  expect(rig.request).toHaveBeenCalledWith('/v1/marketplace/listings/' + listingId + '/usage', {
    method: 'PATCH',
    ownerId: rig.owner,
    body: { enabled: false },
  });
  expect(toggle('Contribute my practice activity').props.value).toBe(false);
});

it('does not open a downloaded deck when the signed-in account changes during the request', async () => {
  const pending = deferred<unknown>();
  const published = listing();
  rig.request.mockImplementation(async (path, options) => {
    if (path.endsWith('/download')) return pending.promise;
    if (options.ownerId === '00000000-0000-4000-8000-000000000006')
      return {
        listing: { ...published, deck: { ...published.deck, name: 'Other account view' } },
        cards: [],
      };
    return { listing: published, cards: [] };
  });
  await mount(React.createElement(MarketplaceDetail));
  await act(async () => {
    button('Download deck').props.onPress();
    button('Download deck').props.onPress();
  });
  expect(rig.request.mock.calls.filter(([path]) => path.endsWith('/download'))).toHaveLength(1);
  rig.owner = '00000000-0000-4000-8000-000000000006';
  await act(async () => renderer!.update(React.createElement(MarketplaceDetail)));
  await act(async () => pending.resolve({ listingId, deckId, version: 1, contributeUsage: false }));
  expect(rig.push).not.toHaveBeenCalled();
  expect(renderer!.root.findByType('screen').props.title).toBe('Other account view');
});

it('keeps publication controls available when the source deck is no longer in the library', async () => {
  let published: MarketplaceListing = {
    ...listing(),
    publisher: { id: rig.owner, name: 'Nico' },
    showDownloadCount: true,
    downloadCount: 9,
  };
  rig.request.mockImplementation(async (_path, options) => {
    if (options.method === 'PATCH') {
      published = {
        ...published,
        ...options.body,
        downloadCount: options.body.showDownloadCount === false ? null : published.downloadCount,
      };
      return published;
    }
    return { listing: published, cards: [] };
  });
  await mount(React.createElement(MarketplaceDetail));
  expect(body()).toContain('original deck is not on this device');
  expect(toggle('Published in marketplace').props.value).toBe(true);
  expect(body()).toContain('9');
  await act(async () => toggle('Show download count').props.onValueChange(false));
  expect(rig.request).toHaveBeenCalledWith('/v1/marketplace/listings/' + listingId, {
    method: 'PATCH',
    ownerId: rig.owner,
    body: { showDownloadCount: false },
  });
  expect(toggle('Show download count').props.value).toBe(false);
  expect(body()).not.toContain('9');
});

it('replaces paginated catalog results when searching and preserves the search draft on failure', async () => {
  const first = listing();
  const second = {
    ...listing(),
    id: '00000000-0000-4000-8000-000000000009',
    deck: { ...first.deck, name: 'Second subject' },
  };
  rig.request.mockImplementation(async (path) => {
    if (path.includes('query=Italian')) throw new Error('Search connection interrupted');
    if (path.includes('cursor=')) return { listings: [second], nextCursor: null };
    return { listings: [first], nextCursor: 'next-page' };
  });
  await mount(React.createElement(MarketplaceCatalog));
  expect(body()).toContain('Alternators');
  await press('More decks');
  expect(body()).toContain('Second subject');
  const field = renderer!.root.findByType('field');
  expect(field.props.maxLength).toBe(100);
  await act(async () => field.props.onChangeText('Italian'));
  await press('Search decks');
  expect(body()).not.toContain('Alternators');
  expect(body()).not.toContain('Second subject');
  expect(body()).toContain('Search connection interrupted');
  expect(renderer!.root.findByType('field').props.value).toBe('Italian');
});
