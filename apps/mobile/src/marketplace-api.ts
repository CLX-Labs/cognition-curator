import * as Crypto from 'expo-crypto';
import {
  contentReportReceiptSchema,
  marketplaceCatalogSchema,
  marketplaceDetailSchema,
  marketplaceDownloadSchema,
  marketplaceDownloadsSchema,
  marketplaceListingSchema,
  marketplaceMineSchema,
  marketplaceSnapshotJson,
} from '@recollect/contracts';
import { api, ApiError } from './api';
import type { LocalSnapshot, Repository } from './repository';

const listingPath = (id: string) => '/v1/marketplace/listings/' + encodeURIComponent(id);
export const marketplaceApi = {
  async catalog(ownerId: string, query = '', cursor?: string) {
    const search = new URLSearchParams({ query: query.trim(), limit: '20' });
    if (cursor) search.set('cursor', cursor);
    return marketplaceCatalogSchema.parse(
      await api.request('/v1/marketplace?' + search.toString(), { ownerId }),
    );
  },
  async mine(ownerId: string) {
    return marketplaceMineSchema.parse(await api.request('/v1/marketplace/mine', { ownerId }));
  },
  async downloads(ownerId: string) {
    return marketplaceDownloadsSchema.parse(
      await api.request('/v1/marketplace/downloads', { ownerId }),
    );
  },
  async detail(ownerId: string, id: string) {
    return marketplaceDetailSchema.parse(await api.request(listingPath(id), { ownerId }));
  },
  async publish(
    ownerId: string,
    body: {
      operationId: string;
      deckId: string;
      rightsAccepted: true;
      expectedContentHash: string;
      showDownloadCount: boolean;
      showUsageStats: boolean;
    },
  ) {
    return marketplaceListingSchema.parse(
      await api.request('/v1/marketplace/listings', { method: 'POST', ownerId, body }),
    );
  },
  async settings(
    ownerId: string,
    id: string,
    body: { isPublished?: boolean; showDownloadCount?: boolean; showUsageStats?: boolean },
  ) {
    return marketplaceListingSchema.parse(
      await api.request(listingPath(id), { method: 'PATCH', ownerId, body }),
    );
  },
  async download(ownerId: string, id: string) {
    return marketplaceDownloadSchema.parse(
      await api.request(listingPath(id) + '/download', { method: 'POST', ownerId, body: {} }),
    );
  },
  async usage(ownerId: string, id: string, enabled: boolean) {
    return marketplaceDownloadSchema.parse(
      await api.request(listingPath(id) + '/usage', {
        method: 'PATCH',
        ownerId,
        body: { enabled },
      }),
    );
  },
  async report(
    ownerId: string,
    id: string,
    body: { reason: 'inappropriate' | 'harassment' | 'spam' | 'other'; details?: string },
  ) {
    contentReportReceiptSchema.parse(
      await api.request(listingPath(id) + '/reports', { method: 'POST', ownerId, body }),
    );
    return true;
  },
  async block(ownerId: string, id: string) {
    await api.request(listingPath(id) + '/block-publisher', { method: 'POST', ownerId, body: {} });
    return true;
  },
};

export type PublicationIntent = {
  operationId: string;
  deckId: string;
  rightsAccepted: true;
  expectedContentHash: string;
  showDownloadCount: boolean;
  showUsageStats: boolean;
  attempted?: boolean;
  reviewedName?: string;
  reviewedCardCount?: number;
};
type PublicationRepository = Pick<
  Repository,
  'ownerId' | 'newId' | 'getState' | 'setState' | 'snapshot'
>;
const publicationKey = (deckId: string) => 'marketplace-publication:' + deckId;

export function pendingMarketplacePublication(
  repository: Pick<Repository, 'getState'>,
  deckId: string,
) {
  return repository.getState<PublicationIntent>(publicationKey(deckId));
}

export function reviewedMarketplaceSnapshot(snapshot: LocalSnapshot, deckId: string) {
  const deck = snapshot.decks.find((item) => item.id === deckId && !item.deletedAt);
  if (!deck) throw new Error('Open an available deck before publishing.');
  const cards = snapshot.cards.filter((card) => card.deckId === deckId && !card.deletedAt);
  if (!cards.length) throw new Error('Add at least one card before publishing.');
  return { json: marketplaceSnapshotJson(deck, cards), name: deck.name, cardCount: cards.length };
}

function publicationChanged() {
  return new ApiError(
    'This deck changed since you reviewed it. Review the current cards and publish again.',
    409,
    'publication_changed',
  );
}

/** Persist the exact request before posting. A lost response must retry the same snapshot operation. */
export async function publishMarketplaceDeck(
  repository: PublicationRepository,
  ownerId: string,
  deckId: string,
  settings: { showDownloadCount: boolean; showUsageStats: boolean },
  sync: () => Promise<void>,
  reviewedJson?: string,
) {
  if (repository.ownerId !== ownerId) throw new Error('The signed-in account changed.');
  const key = publicationKey(deckId);
  const saved = await repository.getState<PublicationIntent>(key);
  let intent: PublicationIntent;
  if (saved?.attempted) {
    intent = saved;
  } else {
    const current = reviewedMarketplaceSnapshot(await repository.snapshot(), deckId);
    if (reviewedJson && current.json !== reviewedJson) throw publicationChanged();
    intent = {
      operationId: saved?.operationId ?? repository.newId(),
      deckId,
      rightsAccepted: true,
      expectedContentHash: await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        reviewedJson ?? current.json,
      ),
      ...settings,
      reviewedName: current.name,
      reviewedCardCount: current.cardCount,
    };
    await repository.setState(key, intent);
  }
  if (intent.deckId !== deckId) throw new Error('This publication belongs to another deck.');
  // Strict sync must reject a failed pull even when this device has no pending edits.
  await sync();
  const snapshot = await repository.snapshot();
  if (snapshot.issues.length)
    throw new Error('Resolve the library conflicts in You before publishing this deck.');
  if (snapshot.pending > 0)
    throw new Error(
      'Sync your pending changes before publishing this deck. Connect and try again.',
    );
  if (!intent.attempted) {
    const current = reviewedMarketplaceSnapshot(snapshot, deckId);
    const currentHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      current.json,
    );
    if (currentHash !== intent.expectedContentHash) {
      await repository.setState(key, null);
      throw publicationChanged();
    }
  }
  // A prior POST may already have succeeded. Retry its exact request so the server can recover
  // that receipt before enforcing the hash against today's private source content.
  await repository.setState(key, { ...intent, attempted: true });
  const { attempted: _attempted, reviewedName: _name, reviewedCardCount: _count, ...body } = intent;
  try {
    const listing = await marketplaceApi.publish(ownerId, body);
    await repository.setState(key, null);
    return listing;
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'publication_changed')
      await repository.setState(key, null);
    throw cause;
  }
}

/** Server uniqueness preserves the receipt across lost responses; sync supplies the independent copy. */
export async function downloadMarketplaceDeck(
  repository: Pick<Repository, 'ownerId' | 'snapshot'>,
  ownerId: string,
  listingId: string,
  sync: () => Promise<void>,
  refresh: () => Promise<void>,
) {
  if (repository.ownerId !== ownerId) throw new Error('The signed-in account changed.');
  const receipt = await marketplaceApi.download(ownerId, listingId);
  await sync();
  await refresh();
  const snapshot = await repository.snapshot();
  if (!snapshot.decks.some((deck) => deck.id === receipt.deckId))
    throw new Error(
      'Your download is saved, but this device has not received its copy. Sync and try again. If you previously deleted this copy, it cannot be downloaded again yet.',
    );
  return receipt;
}
