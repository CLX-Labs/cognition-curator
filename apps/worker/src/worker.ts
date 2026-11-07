import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { ProviderError, type GenerationProvider } from '@recollect/ai';
import {
  DomainError,
  lockOwner,
  releaseGenerationToken,
  transaction,
  type Database,
} from '@recollect/db';
import { resolveWorkerConfig, type WorkerConfig } from './config.js';

type GenerationOutcome = 'completed' | 'ignored' | 'retry' | 'failed';
type AttemptIdentity = {
  component: 'generation-worker';
  jobId: string;
  attempt: number;
  cardCount: number;
  queueWaitMs: number;
};
export type GenerationAttemptEvent = AttemptIdentity &
  (
    | { event: 'attempt-started' }
    | {
        event: 'attempt-finished';
        outcome: GenerationOutcome;
        providerMs: number;
        persistMs: number;
        totalMs: number;
        errorCode: string | null;
      }
  );
export type GenerationObserver = (event: GenerationAttemptEvent) => void;
export type WorkerOptions = Partial<WorkerConfig> & { observer?: GenerationObserver };

function observe(observer: GenerationObserver | undefined, event: GenerationAttemptEvent) {
  try {
    observer?.(event);
  } catch {
    // Telemetry cannot turn committed results into retries or trigger more inference.
  }
}

type ClaimedJob = {
  id: string;
  prompt: string;
  card_count: number;
  attempt: number;
  fence: string;
  queue_wait_ms: number;
};
async function releaseFailedGenerationToken(db: Database, jobId: string): Promise<void> {
  // Worker claims lock the job first. Release in a separate transaction to preserve the
  // API's owner-before-job lock order and avoid deadlocking an acceptance or cancellation.
  const job = (
    await db.query<{ owner_id: string; status: string; token_required: boolean }>(
      'SELECT owner_id,status,token_required FROM recollect.generation_jobs WHERE id=$1',
      [jobId],
    )
  ).rows[0];
  if (!job?.token_required || !['failed', 'canceled'].includes(job.status)) return;
  try {
    await transaction(db, async (tx) => {
      await lockOwner(tx, job.owner_id);
      await releaseGenerationToken(tx, job.owner_id, jobId);
    });
  } catch (error) {
    // Account deletion cancels jobs and erases their wallet through cascading FKs.
    if (!(error instanceof DomainError && error.code === 'account_inactive')) throw error;
  }
}
export async function runGeneration(
  db: Database,
  provider: GenerationProvider,
  jobId: string,
  observer?: GenerationObserver,
): Promise<GenerationOutcome> {
  const started = performance.now();
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
        "UPDATE recollect.generation_jobs SET status='running',attempt=attempt+1,fence=$2,lease_until=now()+interval '120 seconds',updated_at=now() WHERE id=$1 RETURNING id,prompt,card_count,attempt,fence,GREATEST(0,EXTRACT(EPOCH FROM (clock_timestamp()-available_at))*1000)::double precision AS queue_wait_ms",
        [jobId, randomUUID()],
      )
    ).rows[0]!;
  });
  if (!claimed) {
    await releaseFailedGenerationToken(db, jobId);
    return 'ignored';
  }
  const identity: AttemptIdentity = {
    component: 'generation-worker',
    jobId,
    attempt: claimed.attempt,
    cardCount: claimed.card_count,
    // Use database timestamps so queue eligibility and the claim share one clock.
    queueWaitMs: Math.round(claimed.queue_wait_ms),
  };
  observe(observer, { ...identity, event: 'attempt-started' });
  let providerMs = 0,
    persistMs = 0;
  const persist = async <T>(write: () => Promise<T>): Promise<T> => {
    const persistStarted = performance.now();
    try {
      return await write();
    } finally {
      persistMs += Math.round(performance.now() - persistStarted);
    }
  };
  const finish = (outcome: GenerationOutcome, errorCode: string | null): GenerationOutcome => {
    observe(observer, {
      ...identity,
      event: 'attempt-finished',
      outcome,
      providerMs,
      persistMs,
      totalMs: Math.round(performance.now() - started),
      errorCode,
    });
    return outcome;
  };
  try {
    const result = await (async () => {
      const providerStarted = performance.now();
      try {
        return await provider.generate({ prompt: claimed.prompt, count: claimed.card_count });
      } finally {
        providerMs = Math.round(performance.now() - providerStarted);
      }
    })();
    const candidates = result.cards.map((card) => ({ ...card, id: randomUUID() }));
    // Fencing makes retries/cancel safe even when a slow previous provider call eventually returns.
    const saved = await persist(() =>
      db.query(
        "UPDATE recollect.generation_jobs SET status='succeeded',candidates=$3,usage=$4,error=NULL,fence=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND status='running' AND fence=$2 AND lease_until>now()",
        [jobId, claimed.fence, JSON.stringify(candidates), result.usage],
      ),
    );
    return finish(saved.rowCount ? 'completed' : 'ignored', null);
  } catch (error) {
    const retry = error instanceof ProviderError && error.retryable && claimed.attempt < 3;
    const code = error instanceof ProviderError ? error.code : 'generation_failed';
    const saved = await persist(() =>
      db.query(
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
      ),
    );
    if (saved.rowCount && !retry) await releaseFailedGenerationToken(db, jobId);
    return finish(
      saved.rowCount ? (retry ? 'retry' : 'failed') : 'ignored',
      /^[a-z][a-z0-9_]{0,63}$/u.test(code) ? code : 'generation_failed',
    );
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
  options: WorkerOptions = {},
): Promise<() => Promise<void>> {
  const { observer, ...overrides } = options;
  const config = resolveWorkerConfig(overrides);
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
  await boss.work<{ jobId: string }>(
    'recollect-generation',
    {
      batchSize: 1,
      localConcurrency: config.concurrency,
      pollingIntervalSeconds: config.pollingIntervalMs / 1000,
    },
    async (jobs) => {
      for (const job of jobs) {
        const outcome = await runGeneration(db, provider, job.data.jobId, observer);
        if (outcome === 'retry') throw new Error('Generation retry scheduled');
      }
    },
  );
  let stopped = false,
    running: Promise<void> | null = null,
    recovering: Promise<void> | null = null;
  const tick = (): Promise<void> => {
    if (stopped || running) return running ?? Promise.resolve();
    running = (async () => {
      try {
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
  const recover = (): Promise<void> => {
    if (stopped || recovering) return recovering ?? Promise.resolve();
    recovering = (async () => {
      try {
        await recoverAbandonedJobs(db);
      } catch (error) {
        process.stderr.write(
          `Recovery failed: ${error instanceof Error ? error.name : 'unknown'}\n`,
        );
      } finally {
        recovering = null;
      }
    })();
    return recovering;
  };
  await recover();
  await tick();
  const timer = setInterval(() => void tick(), config.dispatchIntervalMs);
  const recoveryTimer = setInterval(() => void recover(), config.recoveryIntervalMs);
  return async () => {
    stopped = true;
    clearInterval(timer);
    clearInterval(recoveryTimer);
    await Promise.all([running, recovering]);
    await boss.stop({ graceful: true, timeout: 100_000 });
  };
}
