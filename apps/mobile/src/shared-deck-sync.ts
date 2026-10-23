import type { Repository } from './repository';

/** Store sync resolves offline failures, so verify the local outbox before publishing a snapshot. */
export async function publishSyncedDeck<T>(
  repository: Pick<Repository, 'snapshot'>,
  sync: () => Promise<void>,
  publish: () => Promise<T>,
): Promise<T> {
  await sync();
  const snapshot = await repository.snapshot();
  if (snapshot.issues.length)
    throw new Error('Resolve the library conflicts in You before sharing this deck.');
  if (snapshot.pending > 0)
    throw new Error('Sync your pending changes before sharing this deck. Connect and try again.');
  return publish();
}

/** Acceptance is durable on the server even if the subsequent download cannot finish. */
export async function downloadSharedDeck(
  repository: Pick<Repository, 'snapshot'>,
  deckId: string,
  sync: () => Promise<void>,
  refresh: () => Promise<void>,
): Promise<void> {
  await sync();
  await refresh();
  const snapshot = await repository.snapshot();
  if (!snapshot.decks.some((deck) => deck.id === deckId))
    throw new Error(
      'Your deck is accepted, but its copy is not on this device yet. Check your connection and sync again.',
    );
}
