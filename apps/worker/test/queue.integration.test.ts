import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ProviderError, type GenerationProvider } from '@recollect/ai';
import { createDatabase, type Database } from '@recollect/db';
import { migrate } from '@recollect/db/migrate';
import { setupQueue } from '../src/setup.js';
import { runGeneration, startWorker, type GenerationAttemptEvent } from '../src/worker.js';

function result() {
  return {
    cards: [{ front: 'Concept', back: 'Answer', hint: '', explanation: '', tags: [] }],
    usage: {
      model: 'test-provider',
      inputTokens: 10,
      outputTokens: 20,
      durationMs: 900_000,
      promptVersion: 'test',
    },
  };
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release() };
}

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
    afterEach(async () => {
      await stop?.();
      stop = undefined;
    });
    afterAll(async () => {
      await stop?.();
      await db?.end();
    });
    async function createJobs(count: number, expiredClaim = false) {
      const owner = randomUUID(),
        deckId = randomUUID();
      await db.query('INSERT INTO recollect.users(id,email,name) VALUES($1,$2,$3)', [
        owner,
        `${owner}@example.test`,
        'Queue test',
      ]);
      await db.query('INSERT INTO recollect.decks(owner_id,id,data) VALUES($1,$2,$3)', [
        owner,
        deckId,
        { id: deckId, ownerId: owner },
      ]);
      const ids: string[] = [];
      for (let index = 0; index < count; index++) {
        const id = randomUUID();
        await db.query(
          "INSERT INTO recollect.generation_jobs(id,owner_id,deck_id,operation_id,payload_hash,prompt,card_count,status,attempt,fence,lease_until,dispatched_at) VALUES($1,$2,$3,$4,'test','Private test topic',1,CASE WHEN $5 THEN 'running' ELSE 'queued' END,CASE WHEN $5 THEN 1 ELSE 0 END,CASE WHEN $5 THEN $6::uuid ELSE NULL END,CASE WHEN $5 THEN now()-interval '1 second' ELSE NULL END,CASE WHEN $5 THEN now() ELSE NULL END)",
          [id, owner, deckId, randomUUID(), expiredClaim, randomUUID()],
        );
        ids.push(id);
      }
      return ids;
    }
    async function waitForSuccess(ids: string[]) {
      await vi.waitFor(
        async () => {
          const rows = (
            await db.query<{ status: string }>(
              'SELECT status FROM recollect.generation_jobs WHERE id=ANY($1::uuid[])',
              [ids],
            )
          ).rows;
          expect(rows).toHaveLength(ids.length);
          expect(rows.every((row) => row.status === 'succeeded')).toBe(true);
        },
        { timeout: 10_000, interval: 50 },
      );
    }
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
    it('bounds concurrent warm-worker deliveries and keeps accepting later jobs', async () => {
      const held = gate();
      let active = 0,
        peak = 0,
        entered = 0;
      const provider: GenerationProvider = {
        generate: async () => {
          active++;
          peak = Math.max(peak, active);
          entered++;
          try {
            if (entered <= 2) await held.promise;
            return result();
          } finally {
            active--;
          }
        },
      };
      stop = await startWorker(db, url, provider);
      try {
        // Insert after startup: a cold-start tick cannot hide the dispatch path.
        const ids = await createJobs(5);
        await vi.waitFor(() => expect(entered).toBe(2), { timeout: 10_000, interval: 50 });
        const running = (
          await db.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM recollect.generation_jobs WHERE id=ANY($1::uuid[]) AND status='running'",
            [ids],
          )
        ).rows[0]!.count;
        expect(running).toBe(2);
        held.release();
        await waitForSuccess(ids);
        expect(peak).toBe(2);
        expect(entered).toBe(5);
        await waitForSuccess(await createJobs(1));
        expect(entered).toBe(6);
      } finally {
        held.release();
      }
    });

    it('honors a serial concurrency override', async () => {
      const held = gate();
      let active = 0,
        peak = 0,
        entered = 0;
      stop = await startWorker(
        db,
        url,
        {
          generate: async () => {
            active++;
            peak = Math.max(peak, active);
            entered++;
            try {
              if (entered === 1) await held.promise;
              return result();
            } finally {
              active--;
            }
          },
        },
        { concurrency: 1 },
      );
      try {
        const ids = await createJobs(3);
        await vi.waitFor(() => expect(entered).toBe(1), { timeout: 10_000, interval: 50 });
        held.release();
        await waitForSuccess(ids);
        expect(peak).toBe(1);
        expect(entered).toBe(3);
      } finally {
        held.release();
      }
    });

    it('fences simultaneous duplicate deliveries to one provider call', async () => {
      const held = gate();
      const producer = new PgBoss({
        connectionString: url,
        schema: 'recollect_boss',
        migrate: false,
        createSchema: false,
      });
      producer.on('error', () => {});
      const provider = {
        generate: vi.fn(async () => {
          await held.promise;
          return result();
        }),
      };
      try {
        const [id] = await createJobs(1);
        // Control both deliveries explicitly so the outbox does not send a third.
        await db.query(
          'UPDATE recollect.generation_jobs SET dispatched_at=now() WHERE id=$1',
          [id],
        );
        await producer.start();
        const deliveries = await Promise.all([
          producer.send('recollect-generation', { jobId: id }),
          producer.send('recollect-generation', { jobId: id }),
        ]);
        expect(deliveries.every(Boolean)).toBe(true);
        stop = await startWorker(db, url, provider);
        await vi.waitFor(
          async () => {
            const jobs = await Promise.all(
              deliveries.map((delivery) =>
                producer.getJobById('recollect-generation', delivery!),
              ),
            );
            // One consumer remains inside inference while the other has already
            // finished the duplicate delivery after observing the active fence.
            expect(jobs.map((job) => job?.state).sort()).toEqual(['active', 'completed']);
          },
          { timeout: 10_000, interval: 50 },
        );
        expect(provider.generate).toHaveBeenCalledTimes(1);
        expect(
          (await db.query('SELECT status,attempt FROM recollect.generation_jobs WHERE id=$1', [id]))
            .rows[0],
        ).toMatchObject({ status: 'running', attempt: 1 });
        held.release();
        await waitForSuccess([id!]);
        expect(provider.generate).toHaveBeenCalledTimes(1);
      } finally {
        held.release();
        await producer.stop();
      }
    });

    it('recovers an expired claim inserted after startup on its separate sweep', async () => {
      const query = vi.spyOn(db, 'query');
      stop = await startWorker(
        db,
        url,
        { generate: async () => result() },
        { recoveryIntervalMs: 5_000 },
      );
      const [id] = await createJobs(1, true);
      await waitForSuccess([id!]);
      expect(
        (await db.query('SELECT attempt FROM recollect.generation_jobs WHERE id=$1', [id]))
          .rows[0].attempt,
      ).toBe(2);
      const recoveryQueries = query.mock.calls.filter(
        ([sql]) =>
          typeof sql === 'string' &&
          sql.includes("WHERE (status='running' AND lease_until<now())"),
      );
      // Startup and the periodic sweep, rather than every 500ms dispatch tick.
      expect(recoveryQueries).toHaveLength(2);
    });

    it('finishes and persists an in-flight attempt before graceful shutdown returns', async () => {
      const held = gate(),
        entered = gate();
      stop = await startWorker(db, url, {
        generate: async () => {
          entered.release();
          await held.promise;
          return result();
        },
      });
      try {
        const ids = await createJobs(1);
        await entered.promise;
        let stopped = false;
        const stopping = stop().then(() => {
          stopped = true;
        });
        expect(
          (await db.query('SELECT status FROM recollect.generation_jobs WHERE id=$1', ids))
            .rows[0].status,
        ).toBe('running');
        expect(stopped).toBe(false);
        held.release();
        await stopping;
        stop = undefined;
        expect(
          (await db.query('SELECT status FROM recollect.generation_jobs WHERE id=$1', ids))
            .rows[0].status,
        ).toBe('succeeded');
      } finally {
        held.release();
      }
    });

    it('measures queue eligibility and safe attempt stages even when an observer throws', async () => {
      const [id] = await createJobs(1);
      await db.query(
        "UPDATE recollect.generation_jobs SET created_at=now()-interval '10 minutes',available_at=now()-interval '1 minute' WHERE id=$1",
        [id],
      );
      const events: GenerationAttemptEvent[] = [];
      const provider = { generate: vi.fn(async () => result()) };
      expect(
        await runGeneration(db, provider, id!, (event) => {
          events.push(event);
          throw new Error('Private telemetry failure');
        }),
      ).toBe('completed');
      expect(provider.generate).toHaveBeenCalledTimes(1);
      expect(events.map((event) => event.event)).toEqual(['attempt-started', 'attempt-finished']);
      expect(events[0]!.queueWaitMs).toBeGreaterThanOrEqual(60_000);
      expect(events[0]!.queueWaitMs).toBeLessThan(600_000);
      const finish = events[1]!;
      expect(finish).toMatchObject({ attempt: 1, outcome: 'completed', cardCount: 1, errorCode: null });
      if (finish.event !== 'attempt-finished') throw new Error('Expected completed attempt event');
      expect(finish.providerMs).toBeGreaterThanOrEqual(0);
      expect(finish.providerMs).toBeLessThan(result().usage.durationMs);
      expect(finish.persistMs).toBeGreaterThanOrEqual(0);
      expect(finish.totalMs).toBeGreaterThanOrEqual(finish.providerMs);
      expect(Object.keys(finish).sort()).toEqual(
        [
          'attempt',
          'cardCount',
          'component',
          'errorCode',
          'event',
          'jobId',
          'outcome',
          'persistMs',
          'providerMs',
          'queueWaitMs',
          'totalMs',
        ].sort(),
      );
      expect(JSON.stringify(events)).not.toContain('Private');
      expect(JSON.stringify(events)).not.toContain('Answer');
      await waitForSuccess([id!]);
    });

    it('records bounded retry outcomes without logging provider error messages', async () => {
      const [id] = await createJobs(1);
      const events: GenerationAttemptEvent[] = [];
      expect(
        await runGeneration(
          db,
          {
            generate: async () => {
              throw new ProviderError('invalid_output', 'Private provider output', true);
            },
          },
          id!,
          (event) => events.push(event),
        ),
      ).toBe('retry');
      expect(events.at(-1)).toMatchObject({
        event: 'attempt-finished',
        attempt: 1,
        outcome: 'retry',
        errorCode: 'invalid_output',
      });
      expect(JSON.stringify(events)).not.toContain('Private');
      expect(
        (
          await db.query(
            'SELECT status,available_at>now() AS waiting FROM recollect.generation_jobs WHERE id=$1',
            [id],
          )
        ).rows[0],
      ).toMatchObject({ status: 'queued', waiting: true });
    });
  },
);
