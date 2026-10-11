import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  cardSchema,
  deckSchema,
  scheduleStateSchema,
  type Deck,
  type ScheduleState,
} from '@recollect/contracts';
import {
  appendChanges,
  createDatabase,
  hash,
  lockOwner,
  transaction,
  type Change,
  type Database,
} from './index.js';

type Raw = Record<string, unknown>;
const asText = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const asNumber = (v: unknown, fallback = 0) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const iso = (v: unknown, fallback: string) => (v ? new Date(String(v)).toISOString() : fallback);
function stableUuid(label: string): string {
  const h = hash(label);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Explicit operator migration. Public tables are only SELECTed, and existing v1 records are never overwritten. */
export async function importLegacy(
  db: Database,
): Promise<{ users: number; decks: number; cards: number; alreadyImported: number }> {
  const present = (
    await db.query<{ present: string | null }>(
      "SELECT to_regclass('public.users')::text AS present",
    )
  ).rows[0]?.present;
  if (!present) throw new Error('No public.users legacy schema exists on this target.');
  const users = (
    await db.query<{ data: Raw }>('SELECT to_jsonb(u) AS data FROM public.users u ORDER BY id')
  ).rows;
  const totals = { users: 0, decks: 0, cards: 0, alreadyImported: 0 };
  for (const { data: rawUser } of users) {
    const outcome = await transaction(db, async (tx) => {
      const owner = asText(rawUser.id).toLowerCase();
      const existing = (
        await tx.query<{ apple_id: string | null; is_active: boolean }>(
          'SELECT apple_id,is_active FROM recollect.users WHERE id=$1',
          [owner],
        )
      ).rows[0];
      if (existing && existing.apple_id !== rawUser.apple_id)
        throw new Error(
          'Legacy identity conflicts with an existing internal UUID. Stop and recover explicitly.',
        );
      if (existing && existing.is_active !== (rawUser.is_active !== false))
        throw new Error(
          'Legacy account activation differs from its existing v1 account. Stop and reconcile activation explicitly.',
        );
      await tx.query(
        'INSERT INTO recollect.users(id,apple_id,email,name,is_active,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',
        [
          owner,
          rawUser.apple_id ?? null,
          rawUser.email ?? null,
          asText(rawUser.name, 'Learner'),
          rawUser.is_active !== false,
          iso(rawUser.created_at, new Date().toISOString()),
        ],
      );
      await lockOwner(tx, owner);
      const rawDecks = (
        await tx.query<{ data: Raw }>(
          'SELECT to_jsonb(d) AS data FROM public.decks d WHERE user_id=$1 ORDER BY id',
          [owner],
        )
      ).rows.map((r) => r.data);
      const rawCards = (
        await tx.query<{ data: Raw }>(
          'SELECT to_jsonb(c) AS data FROM public.flashcards c JOIN public.decks d ON d.id=c.deck_id WHERE d.user_id=$1 ORDER BY c.id',
          [owner],
        )
      ).rows.map((r) => r.data);
      const histories: Record<string, Raw[]> = {};
      for (const sourceType of ['review_sessions', 'study_sessions'] as const) {
        const exists = (
          await tx.query<{ present: string | null }>('SELECT to_regclass($1)::text AS present', [
            'public.' + sourceType,
          ])
        ).rows[0]?.present;
        if (!exists) continue;
        // Identifier comes exclusively from this fixed source list, never user input.
        histories[sourceType] = (
          await tx.query<{ data: Raw }>(
            `SELECT to_jsonb(r) AS data FROM public.${sourceType} r WHERE user_id=$1 ORDER BY id`,
            [owner],
          )
        ).rows.map((row) => row.data);
      }
      const { password_hash: _passwordHash, ...userArchive } = rawUser;
      const manifest = {
        source: 'legacy-python-public-v1',
        user: userArchive,
        decks: rawDecks,
        cards: rawCards,
        histories,
      };
      const fingerprint = hash(manifest),
        batchId = stableUuid('public-v1:' + owner);
      const prior = (
        await tx.query<{ payload_hash: string }>(
          'SELECT payload_hash FROM recollect.import_batches WHERE owner_id=$1 AND batch_id=$2',
          [owner, batchId],
        )
      ).rows[0];
      if (prior) {
        if (prior.payload_hash !== fingerprint)
          throw new Error(
            'Legacy source changed after its migration snapshot. Stop legacy writes and reconcile; no records overwritten.',
          );
        return { decks: 0, cards: 0, already: true };
      }
      const now = new Date().toISOString(),
        changes: Change[] = [];
      const parsedDecks = new Map<string, Deck>();
      for (const raw of rawDecks) {
        const deck = deckSchema.parse({
          id: raw.id,
          ownerId: owner,
          name: raw.name,
          description: asText(raw.description),
          color: asText(raw.color, '#007AFF'),
          icon: asText(raw.icon),
          isSilenced: false,
          silencedUntil: null,
          createdAt: iso(raw.created_at, now),
          updatedAt: iso(raw.updated_at, now),
          deletedAt: raw.is_active === false ? now : null,
          version: 1,
        });
        parsedDecks.set(deck.id, deck);
        const occupied = await tx.query('SELECT 1 FROM recollect.decks WHERE id=$1', [deck.id]);
        if (occupied.rowCount)
          throw new Error(
            'A legacy deck identity already has v1 data; use explicit reconciliation, not overwrite.',
          );
        await tx.query('INSERT INTO recollect.decks(owner_id,id,data) VALUES($1,$2,$3)', [
          owner,
          deck.id,
          deck,
        ]);
        changes.push({ entity: 'deck', data: deck });
      }
      for (const raw of rawCards) {
        const status = asText(raw.status, 'NEW').toLowerCase();
        const phase: ScheduleState['phase'] =
          status === 'new' ? 'new' : status === 'learning' ? 'learning' : 'review';
        const schedule = scheduleStateSchema.parse({
          algorithmVersion: 'sm2-v1',
          phase,
          dueAt: iso(raw.next_review_date, now),
          intervalSeconds: asNumber(raw.interval_days) * 86400,
          easeFactor: asNumber(raw.ease_factor, 2.5),
          learningStep: 0,
          repetitions: asNumber(raw.repetitions),
          lapses: asNumber(raw.mistake_count),
          lastReviewedAt: raw.last_reviewed_at ? iso(raw.last_reviewed_at, now) : null,
          totalReviews: asNumber(raw.total_reviews),
        });
        const deckId = asText(raw.deck_id).toLowerCase();
        const card = cardSchema.parse({
          id: raw.id,
          ownerId: owner,
          deckId,
          front: raw.front,
          back: raw.back,
          hint: asText(raw.hint),
          explanation: asText(raw.explanation),
          tags: Array.isArray(raw.tags) ? raw.tags : [],
          aiGenerated: raw.ai_generated === true,
          schedule,
          createdAt: iso(raw.created_at, now),
          updatedAt: iso(raw.updated_at, now),
          deletedAt: raw.is_active === false || parsedDecks.get(deckId)?.deletedAt ? now : null,
          version: 1,
        });
        const occupied = await tx.query('SELECT 1 FROM recollect.cards WHERE id=$1', [card.id]);
        if (occupied.rowCount)
          throw new Error(
            'A legacy card identity already has v1 data; use explicit reconciliation, not overwrite.',
          );
        await tx.query(
          'INSERT INTO recollect.cards(owner_id,id,deck_id,data,checkpoint,checkpoint_at) VALUES($1,$2,$3,$4,$5,$6)',
          [owner, card.id, card.deckId, card, schedule, now],
        );
        changes.push({ entity: 'card', data: card });
      }
      for (const [sourceType, records] of Object.entries(histories)) {
        for (const data of records)
          await tx.query(
            'INSERT INTO recollect.legacy_archives(owner_id,source_type,source_id,data) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
            [owner, sourceType, String(data.id), data],
          );
      }
      const revision = changes.length ? await appendChanges(tx, owner, changes) : '0';
      const result = {
        decks: rawDecks.length,
        cards: rawCards.length,
        revision,
        checkpointAt: now,
        sourceAlgorithm: 'legacy-python-sm2',
        targetAlgorithm: 'sm2-v1',
        notes:
          'Original values retained. Old reviews are archival and never applied to the imported checkpoint.',
      };
      await tx.query(
        'INSERT INTO recollect.import_batches(owner_id,batch_id,payload_hash,source,manifest,result) VALUES($1,$2,$3,$4,$5,$6)',
        [owner, batchId, fingerprint, 'legacy-python-public-v1', manifest, result],
      );
      return { decks: rawDecks.length, cards: rawCards.length, already: false };
    });
    totals.users++;
    totals.decks += outcome.decks;
    totals.cards += outcome.cards;
    if (outcome.already) totals.alreadyImported++;
  }
  return totals;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL || process.env.CONFIRM_LEGACY_READ_ONLY !== 'yes')
    throw new Error(
      'Set DATABASE_URL and CONFIRM_LEGACY_READ_ONLY=yes only after gating old writers and backing up the reviewed target.',
    );
  const db = createDatabase(process.env.DATABASE_URL);
  try {
    process.stdout.write(JSON.stringify(await importLegacy(db)) + '\n');
  } finally {
    await db.end();
  }
}
