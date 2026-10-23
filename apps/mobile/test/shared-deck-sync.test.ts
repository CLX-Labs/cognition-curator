import { expect, it, vi } from 'vitest';
import type { Deck } from '@recollect/contracts';
import type { LocalSnapshot } from '../src/repository';
import { downloadSharedDeck, publishSyncedDeck } from '../src/shared-deck-sync';

function snapshot(): LocalSnapshot {
  return { decks: [], cards: [], reviews: [], pending: 0, issues: [] };
}

it('does not publish stale server cards when sync resolves with pending local changes', async () => {
  const state = snapshot();
  state.pending = 2;
  const repository = { snapshot: vi.fn(async () => state) };
  // Store.sync deliberately records an offline error and resolves instead of rejecting.
  const sync = vi.fn(async () => {});
  const publish = vi.fn(async () => 'shared snapshot');
  await expect(publishSyncedDeck(repository, sync, publish)).rejects.toThrow(
    'Sync your pending changes',
  );
  expect(publish).not.toHaveBeenCalled();
  state.pending = 0;
  await expect(publishSyncedDeck(repository, sync, publish)).resolves.toBe('shared snapshot');
  expect(publish).toHaveBeenCalledTimes(1);
});

it('requires conflict resolution even when the pending outbox is empty', async () => {
  const state = snapshot();
  state.issues = [{} as LocalSnapshot['issues'][number]];
  const publish = vi.fn(async () => 'shared snapshot');
  await expect(
    publishSyncedDeck({ snapshot: async () => state }, async () => {}, publish),
  ).rejects.toThrow('Resolve the library conflicts');
  expect(publish).not.toHaveBeenCalled();
});

it('keeps an accepted copy pending until a later sync actually downloads its deck', async () => {
  const state = snapshot();
  const repository = { snapshot: vi.fn(async () => state) };
  const sync = vi.fn(async () => {});
  const refresh = vi.fn(async () => {});
  await expect(downloadSharedDeck(repository, 'imported-copy', sync, refresh)).rejects.toThrow(
    'not on this device yet',
  );
  sync.mockImplementation(async () => {
    state.decks = [{ id: 'imported-copy' } as Deck];
  });
  await expect(
    downloadSharedDeck(repository, 'imported-copy', sync, refresh),
  ).resolves.toBeUndefined();
  expect(sync).toHaveBeenCalledTimes(2);
  expect(refresh).toHaveBeenCalledTimes(2);
});
