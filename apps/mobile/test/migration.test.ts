import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { planMigration } from '../src/migration';
import type { LegacyExport } from '../modules/legacy-storage';

function fixture() {
  const owner = randomUUID();
  const deckId = randomUUID();
  const cardId = randomUUID();
  const sync = { syncStatus: 'pending', needsSync: true, lastSyncedAt: null };
  const legacy: LegacyExport = {
    status: 'exported',
    formatVersion: 1,
    manifest: {
      exportId: randomUUID(),
      contentSHA256: 'a'.repeat(64),
      snapshotSHA256: 'b'.repeat(64),
      exportedAt: '2026-10-11T12:00:00.000Z',
      source: {
        sourceId: 'source',
        location: 'application_support',
        fileName: 'default.store',
        byteCount: 1000,
      },
      schemaIdentity: 'cognition_curator',
      schemaSourceRevision: 'old-revision',
      dateEncoding: 'iso8601_utc',
      reviewIntervalUnit: 'minutes',
      counts: { decks: 1, cards: 1, reviews: 1, pendingOps: 0, users: 1 },
      backupFileUri: 'file:///private/backup.sqlite',
      exportFileUri: 'file:///private/export.json',
    },
    ownerHints: {
      trusted: false,
      currentUserId: owner.toUpperCase(),
      cachedUserId: owner,
      storedUserIds: [owner],
    },
    decks: [
      {
        ...sync,
        id: deckId.toUpperCase(),
        name: 'Old Biology',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: null,
        isPremium: false,
        isSuperset: false,
        isSilenced: false,
        silenceType: null,
        silenceEndDate: null,
        combinedDeckIds: null,
        flashcardIds: [cardId],
      },
    ],
    cards: [
      {
        ...sync,
        id: cardId.toUpperCase(),
        question: 'What is ATP?',
        answer: 'An energy carrier.',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: null,
        metadata: { hint: 'Three phosphate groups', tags: ['biology'] },
        deckId: deckId.toUpperCase(),
        reviewSessionIds: [],
      },
    ],
    reviews: [
      {
        ...sync,
        id: randomUUID(),
        difficulty: 2,
        easeFactor: 2.1,
        intervalMinutes: 10,
        reviewedAt: '2026-10-10T12:00:00.000Z',
        nextReview: '2026-10-10T12:10:00.000Z',
        flashcardId: cardId,
      },
    ],
    pendingOps: [],
    users: [{ id: owner, premiumStatus: 'free', preferences: null, algorithmChoice: 'sm2' }],
    settings: {},
  };
  return { legacy, owner, cardId, deckId };
}

describe('reviewable legacy migration', () => {
  it('converts minutes to seconds, preserves next-review dates and archives history without replaying', () => {
    const { legacy, owner, cardId, deckId } = fixture();
    const plan = planMigration(legacy, owner, randomUUID());
    expect(plan.problems).toEqual([]);
    expect(plan.request?.ownershipConfirmed).toBe(false);
    expect(plan.request?.sourceAccountId).toBe(owner);
    expect(plan.request?.cards[0]).toMatchObject({
      id: cardId,
      deckId,
      schedule: {
        intervalSeconds: 600,
        easeFactor: 2.1,
        totalReviews: 1,
        dueAt: '2026-10-10T12:10:00.000Z',
      },
      checkpointAt: legacy.manifest.exportedAt,
    });
    expect(plan.request?.archivedReviews).toEqual(legacy.reviews);
    expect(JSON.stringify(plan.request?.rawManifest)).not.toContain('file:///private/');
    expect(legacy.manifest.backupFileUri).toBe('file:///private/backup.sqlite');
  });
  it('does not quietly null mismatched owner hints to bypass the import owner guard', () => {
    const { legacy, owner } = fixture();
    legacy.ownerHints.cachedUserId = randomUUID();
    const plan = planMigration(legacy, owner, randomUUID());
    expect(plan.request).toBeNull();
    expect(plan.problems.join(' ')).toContain('another account');
  });
  it('leaves unscoped ownership unconfirmed until the user explicitly approves', () => {
    const { legacy, owner } = fixture();
    legacy.ownerHints = {
      trusted: false,
      currentUserId: null,
      cachedUserId: null,
      storedUserIds: [],
    };
    const plan = planMigration(legacy, owner, randomUUID());
    expect(plan.request?.sourceAccountId).toBeNull();
    expect(plan.request?.ownershipConfirmed).toBe(false);
  });
  it('blocks unsupported or corrupt schedules without changing the original evidence', () => {
    const { legacy, owner } = fixture();
    legacy.reviews[0]!.intervalMinutes = -10;
    const original = JSON.stringify(legacy);
    const plan = planMigration(legacy, owner, randomUUID());
    expect(plan.request).toBeNull();
    expect(plan.problems.join(' ')).toContain('not been changed or clamped');
    expect(JSON.stringify(legacy)).toBe(original);
  });
  it('blocks orphaned cards and reports combined-deck behavior before import', () => {
    const { legacy, owner } = fixture();
    legacy.cards[0]!.deckId = randomUUID();
    legacy.decks[0]!.isSuperset = true;
    const plan = planMigration(legacy, owner, randomUUID());
    expect(plan.request).toBeNull();
    expect(plan.problems.join(' ')).toContain('source deck is missing');
    expect(plan.notes.join(' ')).toContain('combined deck');
  });
  it('preserves ordinary legacy fractional intervals and ease above three without clamping', () => {
    const { legacy, owner } = fixture();
    legacy.reviews[0]!.intervalMinutes = 16122.599999999999;
    legacy.reviews[0]!.easeFactor = 3.1;
    const plan = planMigration(legacy, owner, randomUUID());
    expect(plan.problems).toEqual([]);
    expect(plan.request?.cards[0]?.schedule.intervalSeconds).toBe(16122.599999999999 * 60);
    expect(plan.request?.cards[0]?.schedule.easeFactor).toBe(3.1);
    expect(plan.request?.cards[0]?.schedule.dueAt).toBe(legacy.reviews[0]?.nextReview);
    expect(plan.notes.join(' ')).toContain('NEXT rating');
  });
  it('preserves a finite legacy interval longer than the new scheduler limit', () => {
    const { legacy, owner } = fixture();
    legacy.reviews[0]!.intervalMinutes = 4000 * 24 * 60;
    legacy.reviews[0]!.nextReview = '2037-09-23T12:00:00.000Z';
    const plan = planMigration(legacy, owner, randomUUID());
    expect(plan.problems).toEqual([]);
    expect(plan.request?.cards[0]?.schedule.intervalSeconds).toBe(4000 * 86400);
    expect(plan.request?.cards[0]?.schedule.dueAt).toBe('2037-09-23T12:00:00.000Z');
  });
});
