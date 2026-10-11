import { requireOptionalNativeModule } from 'expo-modules-core';

export type LegacyJSON =
  null | boolean | number | string | LegacyJSON[] | { [key: string]: LegacyJSON };

/** These values came from unauthenticated legacy defaults. They never establish ownership. */
export interface LegacyOwnerHints {
  trusted: false;
  currentUserId: string | null;
  cachedUserId: string | null;
  storedUserIds: string[];
}

export interface LegacySource {
  sourceId: string;
  location: 'app_group' | 'application_support' | 'configured';
  fileName: string;
  byteCount: number;
}

export interface LegacyInspection {
  status: 'found' | 'absent' | 'needs_recovery' | 'native_unavailable';
  sources: LegacySource[];
  ownerHints: LegacyOwnerHints;
  message: string;
}

interface LegacySyncFields {
  id: string;
  syncStatus: string;
  needsSync: boolean;
  lastSyncedAt: string | null;
}

export interface LegacyDeck extends LegacySyncFields {
  name: string;
  createdAt: string;
  updatedAt: string | null;
  isPremium: boolean;
  isSuperset: boolean;
  isSilenced: boolean;
  silenceType: string | null;
  silenceEndDate: string | null;
  combinedDeckIds: string[] | null;
  flashcardIds: string[];
}

export interface LegacyCard extends LegacySyncFields {
  question: string;
  answer: string;
  createdAt: string;
  updatedAt: string | null;
  metadata: Record<string, LegacyJSON> | null;
  deckId: string | null;
  reviewSessionIds: string[];
}

export interface LegacyReview extends LegacySyncFields {
  difficulty: number;
  easeFactor: number;
  /** Original Swift value, deliberately not relabeled as days. */
  intervalMinutes: number;
  reviewedAt: string;
  nextReview: string | null;
  flashcardId: string | null;
}

export interface LegacyPendingOperation {
  id: string;
  entityId: string;
  entityType: string;
  operation: string;
  payload: Record<string, LegacyJSON> | null;
  createdAt: string;
  priority: number;
  retryCount: number;
  status: string;
  lastSyncedAt: string | null;
}

/** Export is recovery material, not an authenticated import command or completed migration. */
export interface LegacyExport {
  status: 'exported';
  formatVersion: 1;
  manifest: {
    exportId: string;
    contentSHA256: string;
    snapshotSHA256: string;
    exportedAt: string;
    source: LegacySource;
    schemaIdentity: 'cognition_curator';
    schemaSourceRevision: string;
    dateEncoding: 'iso8601_utc';
    reviewIntervalUnit: 'minutes';
    counts: { decks: number; cards: number; reviews: number; pendingOps: number; users: number };
    backupFileUri: string;
    exportFileUri: string;
  };
  ownerHints: LegacyOwnerHints;
  decks: LegacyDeck[];
  cards: LegacyCard[];
  reviews: LegacyReview[];
  /** Includes synced/failed legacy operations as reconciliation evidence, never auto-replay. */
  pendingOps: LegacyPendingOperation[];
  users: Array<{
    id: string;
    premiumStatus: string;
    preferences: Record<string, LegacyJSON> | null;
    algorithmChoice: string;
  }>;
  settings: Record<string, LegacyJSON>;
}

export type LegacyExportResult =
  | LegacyExport
  | {
      status: 'needs_recovery' | 'native_unavailable';
      message: string;
      /** Preserved SQLite snapshot for an explicit support/export action. Never an import success. */
      backupFileUri?: string;
    };

interface LegacyNativeModule {
  inspectLegacyStore(): Promise<string>;
  exportLegacyStore(): Promise<string>;
}

const native = requireOptionalNativeModule<LegacyNativeModule>('RecollectLegacyStorage');
const emptyHints: LegacyOwnerHints = {
  trusted: false,
  currentUserId: null,
  cachedUserId: null,
  storedUserIds: [],
};

export async function inspectLegacyStore(): Promise<LegacyInspection> {
  if (!native)
    return {
      status: 'native_unavailable',
      sources: [],
      ownerHints: emptyHints,
      message: 'Legacy iOS recovery requires the Recollect development or store build.',
    };
  return JSON.parse(await native.inspectLegacyStore()) as LegacyInspection;
}

export async function exportLegacyStore(): Promise<LegacyExportResult> {
  if (!native)
    return {
      status: 'native_unavailable',
      message: 'The legacy iOS reader is not included in this build.',
    };
  return JSON.parse(await native.exportLegacyStore()) as LegacyExportResult;
}
