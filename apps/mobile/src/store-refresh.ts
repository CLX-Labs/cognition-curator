import type { LocalSnapshot } from './repository';

function shareArray<T>(previous: T[], next: T[]): T[] {
  const shared = next.map((item, index) => {
    const prior = previous[index];
    return prior !== undefined && JSON.stringify(prior) === JSON.stringify(item)
      ? prior
      : item;
  });
  return previous.length === shared.length &&
    shared.every((item, index) => item === previous[index])
    ? previous
    : shared;
}

/** Empty syncs keep screen data/effect dependencies identical. Real edits still propagate. */
export function shareSnapshot(previous: LocalSnapshot, next: LocalSnapshot): LocalSnapshot {
  const shared = {
    decks: shareArray(previous.decks, next.decks),
    cards: shareArray(previous.cards, next.cards),
    reviews: shareArray(previous.reviews, next.reviews),
    issues: shareArray(previous.issues, next.issues),
    pending: next.pending,
  };
  return Object.entries(shared).every(
    ([key, value]) => value === previous[key as keyof LocalSnapshot],
  )
    ? previous
    : shared;
}

/** Serialize snapshot reads; a mutation during a read gets a fresh follow-up read. */
export function createRefreshQueue(work: () => Promise<void>) {
  let flight: Promise<void> | null = null;
  let dirty = false;
  return () => {
    dirty = true;
    if (flight) return flight;
    flight = (async () => {
      do {
        dirty = false;
        await work();
      } while (dirty);
    })().finally(() => {
      flight = null;
    });
    return flight;
  };
}
