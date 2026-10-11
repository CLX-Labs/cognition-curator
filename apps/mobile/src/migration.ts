import {
  importRequestSchema,
  scheduleStateSchema,
  uuidSchema,
  type ImportRequest,
} from '@recollect/contracts';
import { initialSchedule } from '@recollect/scheduler';
import type { LegacyExport, LegacyOwnerHints } from '../modules/legacy-storage';

export type MigrationPlan = {
  request: ImportRequest | null;
  problems: string[];
  notes: string[];
};
function validDate(value: string, label: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(label + ' has an invalid date.');
  return date.toISOString();
}
function ownerCheck(
  hints: LegacyOwnerHints,
  verifiedOwner: string,
): { sourceAccountId: string | null; error?: string } {
  const values = [hints.currentUserId, hints.cachedUserId, ...hints.storedUserIds].filter(
    (value): value is string => !!value,
  );
  const normalized = values.map((value) => uuidSchema.safeParse(value));
  if (normalized.some((value) => !value.success))
    return {
      sourceAccountId: null,
      error:
        'The old library has an unrecognized account identifier. Export it for recovery before importing.',
    };
  const ids = [...new Set(normalized.flatMap((value) => (value.success ? [value.data] : [])))];
  if (ids.some((id) => id !== verifiedOwner.toLowerCase()))
    return {
      sourceAccountId: null,
      error:
        'The old library refers to another account or several accounts. Sign in with the original account, or keep the export for an explicit recovery review.',
    };
  return { sourceAccountId: ids[0] ?? null };
}

/** Build a reviewable migration without modifying the original SwiftData store. */
export function planMigration(
  legacy: LegacyExport,
  verifiedOwner: string,
  batchId: string,
): MigrationPlan {
  const problems: string[] = [];
  const notes: string[] = [];
  const ownership = ownerCheck(legacy.ownerHints, verifiedOwner);
  if (ownership.error) problems.push(ownership.error);
  const exportedAt = validDate(legacy.manifest.exportedAt, 'The export');
  const decks: ImportRequest['decks'] = [];
  const cards: ImportRequest['cards'] = [];
  const deckIds = new Set<string>();
  const cardIds = new Set<string>();
  const supersetCount = legacy.decks.filter((deck) => deck.isSuperset).length;
  if (supersetCount)
    notes.push(
      supersetCount +
        ' combined deck(s) become ordinary decks. Their original membership is preserved in the recovery archive; cards stay in their source decks.',
    );
  for (const deck of legacy.decks) {
    try {
      const id = uuidSchema.parse(deck.id);
      if (deckIds.has(id)) throw new Error('Duplicate deck identifier.');
      deckIds.add(id);
      decks.push({
        id,
        name: deck.name,
        description: '',
        color: '#627A59',
        icon: '▤',
        isSilenced: deck.isSilenced,
        silencedUntil: deck.silenceEndDate
          ? validDate(deck.silenceEndDate, 'Deck ' + deck.name)
          : null,
      });
    } catch (cause) {
      problems.push(
        'Deck “' +
          deck.name +
          '”: ' +
          (cause instanceof Error ? cause.message : 'Cannot map this record.'),
      );
    }
  }
  let derivedDates = 0;
  const legacySchedules: string[] = [];
  for (const card of legacy.cards) {
    try {
      const id = uuidSchema.parse(card.id);
      const deckId = uuidSchema.parse(card.deckId);
      if (!deckIds.has(deckId)) throw new Error('The source deck is missing.');
      if (cardIds.has(id)) throw new Error('Duplicate card identifier.');
      cardIds.add(id);
      const history = legacy.reviews
        .filter((review) => review.flashcardId?.toLowerCase() === id)
        .sort(
          (a, b) =>
            validDate(a.reviewedAt, 'Review').localeCompare(validDate(b.reviewedAt, 'Review')) ||
            a.id.localeCompare(b.id),
        );
      const latest = history.at(-1);
      let schedule = initialSchedule(exportedAt);
      if (latest) {
        const reviewedAt = validDate(latest.reviewedAt, 'Latest review');
        const intervalSeconds = latest.intervalMinutes * 60;
        if (
          !Number.isFinite(intervalSeconds) ||
          intervalSeconds < 0 ||
          intervalSeconds > Number.MAX_SAFE_INTEGER
        ) {
          throw new Error(
            'The legacy interval is negative, nonfinite, or outside the safe numeric range; it has not been changed or clamped.',
          );
        }
        if (reviewedAt > exportedAt)
          throw new Error(
            'The latest review is dated after this export; check the device clock before recovery.',
          );
        const dueAt = latest.nextReview
          ? validDate(latest.nextReview, 'Next review')
          : new Date(Date.parse(reviewedAt) + intervalSeconds * 1000).toISOString();
        if (!latest.nextReview) ++derivedDates;
        schedule = scheduleStateSchema.parse({
          ...schedule,
          phase: intervalSeconds >= 86_400 ? 'review' : 'learning',
          dueAt,
          intervalSeconds,
          easeFactor: latest.easeFactor,
          learningStep: intervalSeconds >= 600 && intervalSeconds < 86_400 ? 1 : 0,
          repetitions: 0,
          lapses: 0,
          lastReviewedAt: reviewedAt,
          totalReviews: history.length,
        });
        if (
          !Number.isInteger(intervalSeconds) ||
          intervalSeconds > 315_360_000 ||
          latest.easeFactor > 3
        ) {
          legacySchedules.push('“' + card.question.slice(0, 60) + '”');
        }
      }
      const metadata = card.metadata ?? {};
      const text = (key: string) =>
        typeof metadata[key] === 'string' ? (metadata[key] as string) : '';
      cards.push({
        id,
        deckId,
        front: card.question,
        back: card.answer,
        hint: text('hint'),
        explanation: text('explanation'),
        tags: Array.isArray(metadata.tags)
          ? metadata.tags.filter((value): value is string => typeof value === 'string')
          : [],
        aiGenerated: metadata.aiGenerated === true || metadata.ai_generated === true,
        schedule,
        checkpointAt: exportedAt,
      });
    } catch (cause) {
      problems.push(
        'Card “' +
          card.question.slice(0, 60) +
          '”: ' +
          (cause instanceof Error ? cause.message : 'Cannot map this record.'),
      );
    }
  }
  if (derivedDates)
    notes.push(
      derivedDates +
        ' next-review date(s) are derived from the recorded review time and interval because the old date was missing.',
    );
  if (legacySchedules.length)
    notes.push(
      legacySchedules.length +
        ' card(s), including ' +
        legacySchedules.slice(0, 5).join(', ') +
        ', have fractional intervals, longer intervals, or higher ease values from the original algorithm. Their CURRENT due dates, intervals, and ease values are preserved exactly; the NEXT rating adopts the new bounded scheduling rules. Every original value remains in your recovery export.',
    );
  notes.push(
    'Existing due dates, intervals, ease factors, and review totals are carried into an SM-2 checkpoint. Legacy streak/lapse counters were not stored and begin at zero. Future reviews use the new shared scheduler.',
  );
  if (legacy.reviews.length)
    notes.push(
      legacy.reviews.length +
        ' historical review records are archived, not replayed as new reviews. The Progress chart starts with reviews made in this version.',
    );
  if (legacy.pendingOps.length)
    notes.push(
      legacy.pendingOps.length +
        ' legacy sync records remain in the recovery archive for reconciliation. They are not submitted as new changes.',
    );
  notes.push(
    'Premium flags and legacy algorithm preferences are preserved in the archive. This version does not sell or infer a subscription.',
  );
  // Paths refer to this device and are not part of the remote recovery evidence.
  const { backupFileUri: _backup, exportFileUri: _export, ...manifest } = legacy.manifest;
  const rawManifest = { ...legacy, manifest };
  const candidate = {
    batchId,
    source: 'swiftdata-v1',
    exportedAt,
    sourceAccountId: ownership.sourceAccountId,
    ownershipConfirmed: false,
    decks,
    cards,
    archivedReviews: legacy.reviews,
    rawManifest,
  };
  const parsed = importRequestSchema.safeParse(candidate);
  if (!parsed.success)
    for (const issue of parsed.error.issues)
      problems.push(issue.path.join('.') + ': ' + issue.message);
  return { request: problems.length || !parsed.success ? null : parsed.data, problems, notes };
}
