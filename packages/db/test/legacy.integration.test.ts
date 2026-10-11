import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cardSchema } from '@recollect/contracts';
import { createDatabase, type Database } from '../src/index.js';
import { importLegacy } from '../src/import-legacy.js';
import { migrate } from '../src/migrate.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('explicit legacy PostgreSQL copy', () => {
  let db: Database;
  const originalTime = '2026-01-01T12:00:00.000Z',
    dueAt = '2026-02-08T12:00:00.000Z';
  const cleanPublic = () =>
    db.query(
      'DROP TABLE IF EXISTS public.review_sessions,public.study_sessions,public.flashcards,public.decks,public.users CASCADE',
    );
  beforeAll(async () => {
    db = createDatabase(process.env.TEST_DATABASE_URL!);
    await cleanPublic();
    await db.query('DROP SCHEMA IF EXISTS recollect CASCADE');
    await migrate(db);
    await db.query(`
      CREATE TABLE public.users(id uuid PRIMARY KEY,apple_id text,email text,name text,is_active boolean,password_hash text,created_at timestamptz);
      CREATE TABLE public.decks(id uuid PRIMARY KEY,user_id uuid,name text,description text,color text,icon text,is_active boolean,created_at timestamptz,updated_at timestamptz);
      CREATE TABLE public.flashcards(id uuid PRIMARY KEY,deck_id uuid,front text,back text,hint text,explanation text,tags jsonb,ai_generated boolean,is_active boolean,status text,ease_factor double precision,interval_days integer,repetitions integer,mistake_count integer,total_reviews integer,next_review_date timestamptz,last_reviewed_at timestamptz,created_at timestamptz,updated_at timestamptz);
      CREATE TABLE public.review_sessions(id uuid PRIMARY KEY,user_id uuid,flashcard_id uuid,difficulty_rating integer,reviewed_at timestamptz);
      CREATE TABLE public.study_sessions(id uuid PRIMARY KEY,user_id uuid,started_at timestamptz);
    `);
  });
  beforeEach(async () => {
    await db.query('TRUNCATE recollect.users CASCADE');
    await db.query(
      'TRUNCATE public.review_sessions,public.study_sessions,public.flashcards,public.decks,public.users',
    );
  });
  afterAll(async () => {
    if (db) {
      await cleanPublic();
      await db.end();
    }
  });
  async function fixture(active = true) {
    const ownerId = randomUUID(),
      deckId = randomUUID(),
      cardId = randomUUID(),
      reviewId = randomUUID();
    await db.query('INSERT INTO public.users VALUES($1,$2,$3,$4,$5,$6,$7)', [
      ownerId,
      'verified-apple-subject',
      'legacy@example.test',
      'Legacy learner',
      active,
      'never-copy-password-hash',
      originalTime,
    ]);
    await db.query('INSERT INTO public.decks VALUES($1,$2,$3,$4,$5,$6,true,$7,$7)', [
      deckId,
      ownerId,
      'Preserved deck',
      'Description',
      '#123ABC',
      'brain',
      originalTime,
    ]);
    await db.query(
      "INSERT INTO public.flashcards VALUES($1,$2,'Question','Answer',NULL,NULL,'[]',true,true,'REVIEW',2.2,8,4,2,7,$3,$4,$4,$4)",
      [cardId, deckId, dueAt, originalTime],
    );
    await db.query('INSERT INTO public.review_sessions VALUES($1,$2,$3,3,$4)', [
      reviewId,
      ownerId,
      cardId,
      originalTime,
    ]);
    await db.query('INSERT INTO public.study_sessions VALUES($1,$2,$3)', [
      randomUUID(),
      ownerId,
      originalTime,
    ]);
    return { ownerId, deckId, cardId, reviewId };
  }
  it('preserves identity, schedule units and raw history without replay or later overwrites', async () => {
    const ids = await fixture();
    expect(await importLegacy(db)).toEqual({ users: 1, decks: 1, cards: 1, alreadyImported: 0 });
    const saved = (
      await db.query('SELECT data,checkpoint,checkpoint_at FROM recollect.cards WHERE id=$1', [
        ids.cardId,
      ])
    ).rows[0]!;
    const card = cardSchema.parse(saved.data);
    expect(card.id).toBe(ids.cardId);
    expect(card.ownerId).toBe(ids.ownerId);
    expect(card.schedule).toMatchObject({
      dueAt,
      intervalSeconds: 8 * 86400,
      easeFactor: 2.2,
      totalReviews: 7,
      repetitions: 4,
      lapses: 2,
    });
    expect(saved.checkpoint).toEqual(card.schedule);
    expect(saved.checkpoint_at.getTime()).toBeGreaterThan(Date.parse(originalTime));
    expect((await db.query('SELECT count(*)::int n FROM recollect.review_events')).rows[0].n).toBe(
      0,
    );
    expect(
      (await db.query('SELECT count(*)::int n FROM recollect.legacy_archives')).rows[0].n,
    ).toBe(2);
    const manifest = (await db.query('SELECT manifest FROM recollect.import_batches')).rows[0]
      .manifest;
    expect(manifest.user).not.toHaveProperty('password_hash');
    expect(manifest.histories.review_sessions[0].id).toBe(ids.reviewId);
    const edited = { ...card, front: 'New application edit', version: 2 };
    await db.query('UPDATE recollect.cards SET data=$2 WHERE id=$1', [ids.cardId, edited]);
    expect(await importLegacy(db)).toEqual({ users: 1, decks: 0, cards: 0, alreadyImported: 1 });
    expect(
      (await db.query('SELECT data FROM recollect.cards WHERE id=$1', [ids.cardId])).rows[0].data
        .front,
    ).toBe('New application edit');
    expect(
      (await db.query('SELECT front FROM public.flashcards WHERE id=$1', [ids.cardId])).rows[0]
        .front,
    ).toBe('Question');
    expect((await db.query('SELECT password_hash FROM public.users')).rows[0].password_hash).toBe(
      'never-copy-password-hash',
    );
  });
  it('detects history-only source changes and leaves the accepted checkpoint intact', async () => {
    const ids = await fixture();
    await importLegacy(db);
    const original = (await db.query('SELECT data,checkpoint FROM recollect.cards')).rows[0];
    await db.query('INSERT INTO public.review_sessions VALUES($1,$2,$3,1,$4)', [
      randomUUID(),
      ids.ownerId,
      ids.cardId,
      originalTime,
    ]);
    await expect(importLegacy(db)).rejects.toThrow('Legacy source changed');
    expect((await db.query('SELECT data,checkpoint FROM recollect.cards')).rows[0]).toEqual(
      original,
    );
    expect(
      (await db.query('SELECT count(*)::int n FROM recollect.legacy_archives')).rows[0].n,
    ).toBe(2);
  });
  it('keeps disabled accounts disabled and rolls back an invalid schedule without partial content', async () => {
    const ids = await fixture(false);
    await db.query('UPDATE public.flashcards SET ease_factor=0.8 WHERE id=$1', [ids.cardId]);
    await expect(importLegacy(db)).rejects.toThrow();
    expect((await db.query('SELECT count(*)::int n FROM recollect.users')).rows[0].n).toBe(0);
    expect((await db.query('SELECT count(*)::int n FROM recollect.decks')).rows[0].n).toBe(0);
    await db.query('UPDATE public.flashcards SET ease_factor=2.2 WHERE id=$1', [ids.cardId]);
    await importLegacy(db);
    expect((await db.query('SELECT is_active FROM recollect.users')).rows[0].is_active).toBe(false);
  });
  it('refuses an activation mismatch with an account created by an earlier Apple login', async () => {
    const ids = await fixture(false);
    await db.query(
      'INSERT INTO recollect.users(id,apple_id,email,name,is_active) VALUES($1,$2,$3,$4,true)',
      [ids.ownerId, 'verified-apple-subject', 'legacy@example.test', 'Earlier login'],
    );
    await expect(importLegacy(db)).rejects.toThrow('account activation differs');
    expect((await db.query('SELECT count(*)::int n FROM recollect.decks')).rows[0].n).toBe(0);
  });
});
