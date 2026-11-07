# Generation worker

The worker runs independently from interactive HTTP requests and uses the same PostgreSQL database. `recollect.generation_jobs` is the durable dispatch outbox and user-visible state machine. pg-boss owns queue delivery in a separate `recollect_boss` schema.

## Setup and run

```bash
CONFIRM_DATABASE_MIGRATION=yes npm run db:migrate
CONFIRM_QUEUE_SETUP=yes npm run setup --workspace @recollect/worker
npm run dev:worker
```

Queue installation is a separate, explicit command using the pinned pg-boss version. Normal worker startup sets `migrate:false` and `createSchema:false` and requires the queue to exist. Review queue schema changes when upgrading pg-boss. Configure `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` explicitly; there is no production mock provider or fallback model.

The provider adapter uses Anthropic's official Messages HTTP API through Node fetch, requests a named tool output, and validates every generated card/count. Actual usage and elapsed time are recorded. Non-successful HTTP responses, invalid output and deadlines produce explicit failures, never invented learning cards.

## Delivery and fencing

Dispatch sends queue work before marking its outbox row dispatched. A crash in between can duplicate delivery; it cannot lose job intent. The database claim serializes contenders, assigns a fresh fencing UUID and a two-minute lease, and increments the attempt count. A worker result can commit only while its attempt still owns a live lease. Cancellation clears the fence. A late abandoned worker cannot resurrect a canceled job or replace a newer result.

Provider calls have a 90-second deadline. Retryable failures use persisted availability times (20 seconds, then 40 seconds) and at most three provider attempts. A periodic sweep recovers expired leases and re-dispatches queued intent that has remained unclaimed for ten minutes, including deliveries lost before an application claim. Stale queue deliveries are harmless because the application checks terminal state, lease/fence and retry availability. Candidate acceptance is separately idempotent and preserves candidate IDs as card IDs.

Application SQL/auth/sync/fencing tests run in the embedded suite. The actual queue lifecycle integration test runs only with a real disposable PostgreSQL server because its extensions/background sessions are not modeled as a production queue by the embedded runner.

## Bounded throughput and delivery latency

Each worker process runs two independent pg-boss consumers by default. Each consumer claims one delivery and awaits its provider call; increasing the batch size would not parallelize that call. Fencing and persisted retry availability still apply to every claim. The durable outbox is checked every 500ms, and consumers poll pg-boss every 500ms. No queue schema change or `LISTEN/NOTIFY` opt-in is needed.

Abandoned-job recovery runs once at startup and separately every 30 seconds. A sweep cannot overlap itself, and a dispatch tick cannot overlap another dispatch tick. Recovery is intentionally slower than dispatch so faster delivery does not repeatedly scan abandoned leases. A crashed attempt may therefore wait up to another recovery interval after its lease expires. Shutdown stops both timers, waits for their active queries, and gracefully drains provider work before closing the queue.

The following optional environment variables are validated before opening the queue. Invalid values stop worker startup rather than silently choosing an unsafe setting.

| Variable | Default | Accepted integers |
| --- | --- | --- |
| `GENERATION_WORKER_CONCURRENCY` | 2 | 1–8 |
| `GENERATION_DISPATCH_INTERVAL_MS` | 500 | 250–60000 |
| `GENERATION_POLL_INTERVAL_MS` | 500 | 500–60000 |
| `GENERATION_RECOVERY_INTERVAL_MS` | 30000 | 5000–300000 |

Concurrency is per process; replicas multiply the inference load. Check provider rate limits, retry rates, database connections, and measured queue wait before raising it. The default of two bounds additional inference load while allowing a second learner's request to proceed during an existing call. Setting concurrency to one restores serial provider execution.

Programmatic callers may pass a fourth `startWorker` argument with the corresponding camel-case options (`concurrency`, `dispatchIntervalMs`, `pollingIntervalMs`, `recoveryIntervalMs`). Defaults do not read the environment implicitly; the production entry point reads and validates environment overrides explicitly.

## Attempt timing

The production entry point emits JSON `attempt-started` and `attempt-finished` events. They contain only job ID, attempt, card count, queue wait, outcome, sanitized error code, and timing numbers. Prompts, generated content, user identifiers, provider error messages, and credentials are excluded. Library callers remain silent unless they pass an optional `observer` callback. An observer failure cannot change a job outcome or repeat inference.

`queueWaitMs` runs from the attempt's persisted `available_at` until the database claim, using the database clock. On a retry it excludes the intentional backoff before eligibility. `providerMs` measures the provider call itself; `persistMs` measures result/error status writes. `totalMs` measures the attempt handler, including the claim and token cleanup, rather than the learner's entire request or earlier attempts. These metrics complement the provider's saved model/token usage, without changing that usage record.

Real PostgreSQL queue tests cover jobs submitted to an already running worker, bounded concurrent bursts, a serial override, simultaneous duplicate delivery, later submissions, periodic recovery, graceful draining, and safe telemetry. Use only a disposable `TEST_DATABASE_URL`: the suite drops its `recollect` and `recollect_boss` schemas. No latency threshold is asserted in correctness tests; compare performance with the separate generation benchmark.
