import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from '@recollect/db';
import { migrate } from '@recollect/db/migrate';
import { setupQueue } from '../src/setup.js';
import { startWorker } from '../src/worker.js';

describe.skipIf(!process.env.TEST_DATABASE_URL || process.env.RECOLLECT_EMBEDDED_TEST === 'true')(
  'real PostgreSQL pg-boss delivery',
  () => {
    let db: Database, stop: (() => Promise<void>) | undefined;
    const url = process.env.TEST_DATABASE_URL ?? '';
    beforeAll(async () => {
      db = createDatabase(url);
      await db.query('DROP SCHEMA IF EXISTS recollect_boss CASCADE');
      await db.query('DROP SCHEMA IF EXISTS recollect CASCADE');
      await migrate(db);
      await setupQueue(url);
    });
    afterAll(async () => {
      await stop?.();
      await db?.end();
    });
    it('dispatches durable intent through the actual queue and commits validated candidates', async () => {
      const owner = randomUUID(),
        deckId = randomUUID(),
        jobId = randomUUID();
      await db.query('INSERT INTO recollect.users(id,email,name) VALUES($1,$2,$3)', [
        owner,
        'queue@example.test',
        'Queue test',
      ]);
      await db.query('INSERT INTO recollect.decks(owner_id,id,data) VALUES($1,$2,$3)', [
        owner,
        deckId,
        { id: deckId, ownerId: owner },
      ]);
      await db.query(
        "INSERT INTO recollect.generation_jobs(id,owner_id,deck_id,operation_id,payload_hash,prompt,card_count,status) VALUES($1,$2,$3,$4,'test','Cell biology',1,'queued')",
        [jobId, owner, deckId, randomUUID()],
      );
      stop = await startWorker(db, url, {
        generate: async () => ({
          cards: [{ front: 'Question', back: 'Answer', hint: '', explanation: '', tags: [] }],
          usage: {
            model: 'test-provider',
            inputTokens: 10,
            outputTokens: 20,
            durationMs: 5,
            promptVersion: 'test',
          },
        }),
      });
      await vi.waitFor(
        async () => {
          const result = (
            await db.query<{ status: string; candidates: unknown[] }>(
              'SELECT status,candidates FROM recollect.generation_jobs WHERE id=$1',
              [jobId],
            )
          ).rows[0]!;
          expect(result.status).toBe('succeeded');
          expect(result.candidates).toHaveLength(1);
        },
        { timeout: 10000, interval: 100 },
      );
    });
  },
);
