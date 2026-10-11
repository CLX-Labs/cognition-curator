import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { ProviderError, type GenerationProvider } from '@recollect/ai';
import { transaction, type Database } from '@recollect/db';

type ClaimedJob = {
  id: string;
  prompt: string;
  card_count: number;
  attempt: number;
  fence: string;
};
export async function runGeneration(
  db: Database,
  provider: GenerationProvider,
  jobId: string,
): Promise<'completed' | 'ignored' | 'retry' | 'failed'> {
  const claimed = await transaction(db, async (tx) => {
    const row = (
      await tx.query<{
        status: string;
        attempt: number;
        lease_until: Date | null;
        available_at: Date;
      }>(
        'SELECT status,attempt,lease_until,available_at FROM recollect.generation_jobs WHERE id=$1 FOR UPDATE',
        [jobId],
      )
    ).rows[0];
    if (!row || ['succeeded', 'failed', 'canceled'].includes(row.status)) return null;
    if (row.status === 'running' && row.lease_until && row.lease_until.getTime() > Date.now())
      return null;
    if (row.status === 'queued' && row.available_at.getTime() > Date.now()) return null;
    if (row.attempt >= 3) {
      await tx.query(
        "UPDATE recollect.generation_jobs SET status='failed',fence=NULL,lease_until=NULL,error=$2,updated_at=now() WHERE id=$1",
        [
          jobId,
          { code: 'attempts_exhausted', message: 'Generation exhausted its bounded attempts.' },
        ],
      );
      return null;
    }
    return (
      await tx.query<ClaimedJob>(
        "UPDATE recollect.generation_jobs SET status='running',attempt=attempt+1,fence=$2,lease_until=now()+interval '120 seconds',updated_at=now() WHERE id=$1 RETURNING id,prompt,card_count,attempt,fence",
        [jobId, randomUUID()],
      )
    ).rows[0]!;
  });
  if (!claimed) return 'ignored';
  try {
    const result = await provider.generate({ prompt: claimed.prompt, count: claimed.card_count });
    const candidates = result.cards.map((card) => ({ ...card, id: randomUUID() }));
    // Fencing makes retries/cancel safe even when a slow previous provider call eventually returns.
    const saved = await db.query(
      "UPDATE recollect.generation_jobs SET status='succeeded',candidates=$3,usage=$4,error=NULL,fence=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND status='running' AND fence=$2 AND lease_until>now()",
      [jobId, claimed.fence, JSON.stringify(candidates), result.usage],
    );
    return saved.rowCount ? 'completed' : 'ignored';
  } catch (error) {
    const retry = error instanceof ProviderError && error.retryable && claimed.attempt < 3;
    const code = error instanceof ProviderError ? error.code : 'generation_failed';
    const saved = await db.query(
      "UPDATE recollect.generation_jobs SET status=$3,error=$4,fence=NULL,lease_until=NULL,dispatched_at=CASE WHEN $3='queued' THEN NULL ELSE dispatched_at END,available_at=CASE WHEN $3='queued' THEN now()+($5::int*interval '1 second') ELSE available_at END,updated_at=now() WHERE id=$1 AND status='running' AND fence=$2 AND lease_until>now()",
      [
        jobId,
        claimed.fence,
        retry ? 'queued' : 'failed',
        {
          code,
          message: retry
            ? 'Generation will retry within its attempt limit.'
            : 'Generation failed. No fallback cards were created.',
        },
        10 * 2 ** claimed.attempt,
      ],
    );
    return saved.rowCount ? (retry ? 'retry' : 'failed') : 'ignored';
  }
}

/** Job rows are the durable dispatch outbox. A crash after send and before the UPDATE can duplicate delivery, never lose intent. */
export async function dispatchPending(
  db: Database,
  send: (jobId: string) => Promise<unknown>,
): Promise<number> {
  return transaction(db, async (tx) => {
    const jobs = (
      await tx.query<{ id: string }>(
        "SELECT id FROM recollect.generation_jobs WHERE status='queued' AND dispatched_at IS NULL AND available_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 10",
      )
    ).rows;
    for (const job of jobs) {
      await send(job.id);
      await tx.query('UPDATE recollect.generation_jobs SET dispatched_at=now() WHERE id=$1', [
        job.id,
      ]);
    }
    return jobs.length;
  });
}
/** Redispatch lost deliveries as well as crashed claims. Duplicate deliveries cannot acquire an active fenced lease. */
export async function recoverAbandonedJobs(db: Database): Promise<number> {
  const result = await db.query(
    "UPDATE recollect.generation_jobs SET status='queued',fence=NULL,lease_until=NULL,dispatched_at=NULL,updated_at=now() WHERE (status='running' AND lease_until<now()) OR (status='queued' AND dispatched_at<now()-interval '10 minutes')",
  );
  return result.rowCount ?? 0;
}
export async function startWorker(
  db: Database,
  databaseUrl: string,
  provider: GenerationProvider,
): Promise<() => Promise<void>> {
  const boss = new PgBoss({
    connectionString: databaseUrl,
    schema: 'recollect_boss',
    migrate: false,
    createSchema: false,
  });
  boss.on('error', (error) =>
    process.stderr.write(`Queue error: ${error instanceof Error ? error.name : 'unknown'}\n`),
  );
  await boss.start();
  if (!(await boss.getQueue('recollect-generation'))) {
    await boss.stop();
    throw new Error('Queue not initialized. Run the explicit worker setup command first.');
  }
  await boss.work<{ jobId: string }>('recollect-generation', { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      const outcome = await runGeneration(db, provider, job.data.jobId);
      if (outcome === 'retry') throw new Error('Generation retry scheduled');
    }
  });
  let stopped = false,
    running: Promise<void> | null = null;
  const tick = (): Promise<void> => {
    if (stopped || running) return running ?? Promise.resolve();
    running = (async () => {
      try {
        await recoverAbandonedJobs(db);
        await dispatchPending(db, async (jobId) => {
          const id = await boss.send('recollect-generation', { jobId });
          if (!id) throw new Error('Queue did not accept dispatch');
        });
      } catch (error) {
        process.stderr.write(
          `Dispatch failed: ${error instanceof Error ? error.name : 'unknown'}\n`,
        );
      } finally {
        running = null;
      }
    })();
    return running;
  };
  await tick();
  const timer = setInterval(() => void tick(), 3000);
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
    await boss.stop({ graceful: true, timeout: 100_000 });
  };
}
