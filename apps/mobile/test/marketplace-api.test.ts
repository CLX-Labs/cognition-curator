import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MarketplaceListing } from '@recollect/contracts';
import { Repository, type LocalSnapshot } from '../src/repository';
import { TestDatabase } from './sqlite';
const request = vi.hoisted(() => vi.fn());
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    (await import('node:crypto')).createHash('sha256').update(value).digest('hex'),
}));
vi.mock('../src/api', () => ({
  api: { request },
  ApiError: class extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code?: string,
    ) {
      super(message);
    }
  },
}));
import { ApiError } from '../src/api';
import {
  downloadMarketplaceDeck,
  marketplaceApi,
  publishMarketplaceDeck,
  reviewedMarketplaceSnapshot,
} from '../src/marketplace-api';

const databases: TestDatabase[] = [];
beforeEach(() => request.mockReset());
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function fixture() {
  const db = new TestDatabase();
  databases.push(db);
  const ownerId = randomUUID();
  const repo = new Repository(db, ownerId, randomUUID(), randomUUID);
  await repo.initialize();
  await repo.saveDeck({
    id: randomUUID(),
    name: 'Alternators',
    description: '',
    color: '#343AE7',
    icon: 'spark',
    isSilenced: false,
    silencedUntil: null,
  });
  const deck = (await repo.snapshot()).decks[0]!;
  await repo.saveCard({
    id: randomUUID(),
    deckId: deck.id,
    front: 'Alternator',
    back: 'Converts mechanical energy into electricity.',
    hint: '',
    explanation: '',
    tags: [],
    aiGenerated: false,
  });
  return { db, repo, ownerId, deck };
}
function listing(ownerId: string, deckId: string): MarketplaceListing {
  return {
    id: randomUUID(),
    publisher: { id: ownerId, name: 'A learner' },
    sourceDeckId: deckId,
    deck: { name: 'Alternators', description: '', color: '#343AE7', icon: 'spark' },
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
const snapshot = (): LocalSnapshot => ({
  decks: [],
  cards: [],
  reviews: [],
  pending: 0,
  issues: [],
});

it('persists publication identity before HTTP and retries the same request after a lost response and remount', async () => {
  const { db, repo, ownerId, deck } = await fixture();
  // Isolate this orchestration test from the separately verified sync engine.
  const state = { ...(await repo.snapshot()), pending: 0 };
  vi.spyOn(repo, 'snapshot').mockResolvedValue(state);
  const published = listing(ownerId, deck.id);
  let savedOperation: string | undefined;
  let savedHash: string | undefined;
  request.mockImplementationOnce(async (_path, options) => {
    const persisted = await repo.getState<{ operationId: string }>(
      'marketplace-publication:' + deck.id,
    );
    expect(persisted?.operationId).toBe(options.body.operationId);
    savedOperation = options.body.operationId;
    savedHash = options.body.expectedContentHash;
    throw new Error('Response lost after commit');
  });
  await expect(
    publishMarketplaceDeck(
      repo,
      ownerId,
      deck.id,
      { showDownloadCount: false, showUsageStats: false },
      async () => {},
    ),
  ).rejects.toThrow('Response lost');
  const reopened = new Repository(db, ownerId, randomUUID(), randomUUID);
  vi.spyOn(reopened, 'snapshot').mockResolvedValue({
    ...state,
    cards: state.cards.map((card) => ({ ...card, front: 'Private changes after publication' })),
  });
  request.mockResolvedValueOnce(published);
  await expect(
    publishMarketplaceDeck(
      reopened,
      ownerId,
      deck.id,
      { showDownloadCount: true, showUsageStats: true },
      async () => {},
    ),
  ).resolves.toEqual(published);
  expect(request.mock.calls[1]![1]).toEqual({
    method: 'POST',
    ownerId,
    body: {
      operationId: savedOperation,
      deckId: deck.id,
      rightsAccepted: true,
      expectedContentHash: savedHash,
      showDownloadCount: false,
      showUsageStats: false,
    },
  });
  expect(await reopened.getState('marketplace-publication:' + deck.id)).toBeNull();
});

it('does not publish after a strict pull failure even when the local outbox is empty', async () => {
  const { repo, ownerId, deck } = await fixture();
  vi.spyOn(repo, 'snapshot').mockResolvedValue({ ...(await repo.snapshot()), pending: 0 });
  const sync = vi.fn(async () => {
    throw new Error('Pull failed');
  });
  await expect(
    publishMarketplaceDeck(
      repo,
      ownerId,
      deck.id,
      { showDownloadCount: false, showUsageStats: false },
      sync,
    ),
  ).rejects.toThrow('Pull failed');
  expect(request).not.toHaveBeenCalled();
  expect(await repo.getState('marketplace-publication:' + deck.id)).toMatchObject({
    expectedContentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
});

it('requires review again if strict synchronization replaces the approved cards before the first POST', async () => {
  const { repo, ownerId, deck } = await fixture();
  let state = { ...(await repo.snapshot()), pending: 0 };
  const reviewed = reviewedMarketplaceSnapshot(state, deck.id);
  vi.spyOn(repo, 'snapshot').mockImplementation(async () => state);
  await expect(
    publishMarketplaceDeck(
      repo,
      ownerId,
      deck.id,
      { showDownloadCount: false, showUsageStats: false },
      async () => {
        state = {
          ...state,
          cards: state.cards.map((card) => ({ ...card, front: 'Unseen remote revision' })),
        };
      },
      reviewed.json,
    ),
  ).rejects.toThrow('changed since you reviewed');
  expect(request).not.toHaveBeenCalled();
  expect(await repo.getState('marketplace-publication:' + deck.id)).toBeNull();
});

it('requires review again when synchronization changes the cover image before publication', async () => {
  const { repo, ownerId, deck } = await fixture();
  let state = { ...(await repo.snapshot()), pending: 0 };
  const reviewed = reviewedMarketplaceSnapshot(state, deck.id);
  vi.spyOn(repo, 'snapshot').mockImplementation(async () => state);
  await expect(
    publishMarketplaceDeck(
      repo,
      ownerId,
      deck.id,
      { showDownloadCount: false, showUsageStats: false },
      async () => {
        state = {
          ...state,
          decks: state.decks.map((item) => ({
            ...item,
            imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
          })),
        };
      },
      reviewed.json,
    ),
  ).rejects.toThrow('changed since you reviewed');
  expect(request).not.toHaveBeenCalled();
  expect(await repo.getState('marketplace-publication:' + deck.id)).toBeNull();
});

it('clears a definitively rejected content precondition without discarding an ambiguous request', async () => {
  const { repo, ownerId, deck } = await fixture();
  vi.spyOn(repo, 'snapshot').mockResolvedValue({ ...(await repo.snapshot()), pending: 0 });
  request.mockRejectedValueOnce(new ApiError('Review current cards', 409, 'publication_changed'));
  await expect(
    publishMarketplaceDeck(
      repo,
      ownerId,
      deck.id,
      { showDownloadCount: false, showUsageStats: false },
      async () => {},
    ),
  ).rejects.toThrow('Review current cards');
  expect(await repo.getState('marketplace-publication:' + deck.id)).toBeNull();
});

it('uses the latest visibility choices when a prepared request has never reached the server', async () => {
  const { repo, ownerId, deck } = await fixture();
  vi.spyOn(repo, 'snapshot').mockResolvedValue({ ...(await repo.snapshot()), pending: 0 });
  await expect(
    publishMarketplaceDeck(
      repo,
      ownerId,
      deck.id,
      { showDownloadCount: false, showUsageStats: false },
      async () => {
        throw new Error('Pull failed');
      },
    ),
  ).rejects.toThrow('Pull failed');
  const saved = await repo.getState<{ operationId: string }>('marketplace-publication:' + deck.id);
  request.mockResolvedValueOnce(listing(ownerId, deck.id));
  await publishMarketplaceDeck(
    repo,
    ownerId,
    deck.id,
    { showDownloadCount: true, showUsageStats: false },
    async () => {},
  );
  expect(request).toHaveBeenCalledWith(
    '/v1/marketplace/listings',
    expect.objectContaining({
      body: expect.objectContaining({
        operationId: saved?.operationId,
        showDownloadCount: true,
        showUsageStats: false,
      }),
    }),
  );
});

it('does not publish while sync leaves pending edits, and rejects a different account before HTTP', async () => {
  const { repo, ownerId, deck } = await fixture();
  await expect(
    publishMarketplaceDeck(
      repo,
      ownerId,
      deck.id,
      { showDownloadCount: false, showUsageStats: false },
      async () => {},
    ),
  ).rejects.toThrow('pending changes');
  await expect(
    publishMarketplaceDeck(
      repo,
      randomUUID(),
      deck.id,
      { showDownloadCount: false, showUsageStats: false },
      async () => {},
    ),
  ).rejects.toThrow('account changed');
  expect(request).not.toHaveBeenCalled();
  expect(await repo.getState('marketplace-publication:' + deck.id)).toMatchObject({
    deckId: deck.id,
    expectedContentHash: expect.any(String),
  });
});

it('keeps a server download receipt recoverable and confirms the synced copy before returning it', async () => {
  const { repo, ownerId, deck } = await fixture();
  const receipt = { listingId: randomUUID(), deckId: deck.id, version: 1, contributeUsage: false };
  request.mockResolvedValue(receipt);
  const state = snapshot();
  vi.spyOn(repo, 'snapshot').mockImplementation(async () => state);
  const sync = vi.fn(async () => {});
  const refresh = vi.fn(async () => {});
  await expect(
    downloadMarketplaceDeck(repo, ownerId, receipt.listingId, sync, refresh),
  ).rejects.toThrow('not received its copy');
  state.decks = [deck];
  await expect(
    downloadMarketplaceDeck(repo, ownerId, receipt.listingId, sync, refresh),
  ).resolves.toEqual(receipt);
  expect(request.mock.calls.map(([path, options]) => [path, options])).toEqual([
    [
      '/v1/marketplace/listings/' + receipt.listingId + '/download',
      { ownerId, method: 'POST', body: {} },
    ],
    [
      '/v1/marketplace/listings/' + receipt.listingId + '/download',
      { ownerId, method: 'POST', body: {} },
    ],
  ]);
  expect(sync).toHaveBeenCalledTimes(2);
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('sends independent owner metric toggles and explicit per-copy contribution revocation', async () => {
  const ownerId = randomUUID(),
    deckId = randomUUID();
  const published = listing(ownerId, deckId);
  request.mockResolvedValueOnce(published);
  await marketplaceApi.settings(ownerId, published.id, { showDownloadCount: false });
  expect(request).toHaveBeenLastCalledWith('/v1/marketplace/listings/' + published.id, {
    method: 'PATCH',
    ownerId,
    body: { showDownloadCount: false },
  });
  request.mockResolvedValueOnce({
    listingId: published.id,
    deckId,
    version: 1,
    contributeUsage: false,
  });
  await marketplaceApi.usage(ownerId, published.id, false);
  expect(request).toHaveBeenLastCalledWith('/v1/marketplace/listings/' + published.id + '/usage', {
    method: 'PATCH',
    ownerId,
    body: { enabled: false },
  });
});
