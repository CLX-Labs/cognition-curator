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
