import { expect, it, vi } from 'vitest';
import type { Deck } from '@recollect/contracts';
import type { LocalSnapshot } from '../src/repository';
import { createRefreshQueue, shareSnapshot } from '../src/store-refresh';

const empty = (): LocalSnapshot => ({
  decks: [],
  cards: [],
  reviews: [],
  pending: 0,
  issues: [],
});
const deck = (id: string, name: string): Deck => ({
  id,
  name,
  ownerId: 'owner',
  description: '',
  color: '',
  icon: '',
  isSilenced: false,
  silencedUntil: null,
  version: 1,
  createdAt: '2026-10-13T00:00:00Z',
  updatedAt: '2026-10-13T00:00:00Z',
  deletedAt: null,
});

it('an identical SQLite snapshot preserves the library and every slice reference', () => {
  const before = { ...empty(), decks: [deck('a', 'Biology')] };
  expect(shareSnapshot(before, structuredClone(before))).toBe(before);
});

it('real edits propagate while unrelated slices and unchanged entities keep their identity', () => {
  const before = { ...empty(), decks: [deck('a', 'Biology'), deck('b', 'Literature')] };
  const next = structuredClone(before);
  next.decks[0]!.name = 'Biochemistry';
  next.pending = 1;
  const shared = shareSnapshot(before, next);
  expect(shared).not.toBe(before);
  expect(shared.pending).toBe(1);
  expect(shared.decks[0]!.name).toBe('Biochemistry');
  expect(shared.decks[1]).toBe(before.decks[1]);
  expect(shared.cards).toBe(before.cards);
  expect(shared.reviews).toBe(before.reviews);
});

it('overlapping refreshes serialize and reread a mutation made during the first snapshot', async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let version = 1,
    displayed = 0;
  const work = vi.fn(async () => {
    const captured = version;
    if (work.mock.calls.length === 1) await held;
    displayed = captured;
  });
  const refresh = createRefreshQueue(work);
  const first = refresh();
  version = 2;
  const second = refresh();
  const third = refresh();
  expect(second).toBe(first);
  expect(third).toBe(first);
  expect(work).toHaveBeenCalledTimes(1);
  release();
  await first;
  expect(work).toHaveBeenCalledTimes(2);
  expect(displayed).toBe(2);
});

it('a failed refresh releases the flight so a later retry can succeed', async () => {
  const work = vi.fn(async () => {}).mockRejectedValueOnce(new Error('read failed'));
  const refresh = createRefreshQueue(work);
  await expect(refresh()).rejects.toThrow('read failed');
  await refresh();
  expect(work).toHaveBeenCalledTimes(2);
});
