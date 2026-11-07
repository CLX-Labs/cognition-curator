# Generation performance

Measure the existing worker before changing queue or provider behavior. The benchmark uses fixed synthetic answer, five-card and ten-card fixtures. It records no prompts, card contents, API keys, account IDs, job IDs or database URLs. It does not load `.env` and never reads `DATABASE_URL`.

Use Node 24 and install the locked dependencies with `npm ci`. Run the CLI through the existing `tsx` loader:

```sh
node --import=tsx scripts/benchmark-generations.mjs --help
node --test scripts/test-benchmark-generations.mjs
```

## Queue baseline and comparison

The main benchmark uses the actual `GenerationService.create`, durable dispatch outbox, `setupQueue`, production `startWorker`, pg-boss polling and result persistence. A synthetic provider with a fixed delay separates queue overhead from inference variability without spending inference credits.

Create a fresh disposable local PostgreSQL database for **each run**. Set `BENCHMARK_DATABASE_URL` to its loopback URL; the database name must begin with `recollect_` and contain `benchmark`. The harness refuses an existing `recollect` or `recollect_boss` schema and never drops or resets one. It creates schemas and synthetic data only in that explicit local benchmark target. Stop and remove the disposable database/cluster after collecting results; do not point this command at the application database.

```sh
BENCHMARK_DATABASE_URL=postgresql://recollect_benchmark@127.0.0.1:59432/recollect_generation_benchmark \
  node --import=tsx scripts/benchmark-generations.mjs \
  --mode queue --scenario all --samples 10 --warmup 1 \
  --concurrency 1 --fake-delay-ms 300 --output /tmp/generation-before-serial.json

# Use another newly created empty benchmark database for the burst.
BENCHMARK_DATABASE_URL=postgresql://recollect_benchmark@127.0.0.1:59432/recollect_generation_benchmark_burst \
  node --import=tsx scripts/benchmark-generations.mjs \
  --mode queue --scenario cards5 --samples 8 --warmup 1 \
  --concurrency 8 --fake-delay-ms 2000 --output /tmp/generation-before-burst.json
```

Run the same commands with fresh databases and `after` output names after the optimization. Keep the same machine, PostgreSQL version, Node version, scenario, concurrency, provider delay and sample count. Warmups are sequential, recorded separately, and excluded from measured percentiles. The worker stays warm for the entire run. `--submission-gap-ms` adds a delay before each measured request in each client lane; use matching gaps to sample idle dispatch phases. A zero gap measures consecutive submissions or a simultaneous burst.

Every artifact includes the git commit, tracked-change flag, source hashes for the harness/worker/provider/API, runtime, model, fixture version, workload settings, individual measurements, per-scenario summaries, p50/p95, error rate, attempts and available input/output token counts. Output files are created with exclusive write and private permissions so a baseline cannot be accidentally overwritten. The harness exits nonzero for failed measured requests or failed warmups. Failed requests count toward error rate, while latency percentiles include successful requests only. Report error rate alongside percentiles; never call a faster failing workload an improvement.

### Timing definitions

| Field | Measurement |
| --- | --- |
| `enqueueMs` | Start of generation service request through successful durable job creation. |
| `queueWaitMs` | Successful create return through first provider call, including dispatch timer, pg-boss polling, worker availability and claiming. |
| `providerMs` | Sum of time spent in provider calls, including failed attempts. |
| `completionObserveMs` | Last provider call completion through observing a terminal persisted status, including the harness's 20 ms database observation interval. |
| `totalMs` | Request start through observed terminal status. |

The measured queue path starts at the generation service rather than an HTTP connection. It excludes network latency, authentication, API rate limiting and mobile polling/rendering. Retry backoff contributes to total latency and queue waits after the first attempt; provider time sums all observed attempts. It therefore need not equal the sum of displayed stages when retries occur. The synthetic model reports zero inference tokens. Local PostgreSQL timings are a controlled comparison, not a claim about production latency under real traffic.

With ten samples, nearest-rank p95 is the slowest sample. Use at least 20–50 measured requests per scenario for a more stable tail estimate; bounded sample counts allow up to 100 per scenario, 10 warmups and concurrency 10. Small first-pass runs are useful for finding multi-second polling delays or serialized bursts, with uncertainty clearly stated.

## Direct smoke checks

```sh
# Provider adapter alone; no database or network access with the default fake provider.
node --import=tsx scripts/benchmark-generations.mjs \
  --mode provider --scenario all --samples 3 --warmup 1 --fake-delay-ms 300

# Ephemeral PGlite checks durable creation, direct dispatch, claiming and persistence.
node --import=tsx scripts/benchmark-generations.mjs \
  --mode embedded --scenario all --samples 2 --warmup 1 --fake-delay-ms 300
```

Embedded mode intentionally supports one client at a time. It dispatches and runs jobs directly, so it **excludes** the dispatch timer, pg-boss polling and real PostgreSQL connection concurrency. Use it as a portable smoke check, never as the queue baseline.

## Explicit live provider checks

Live checks cost money and send only the fixed synthetic benchmark fixtures. They require all of `--provider anthropic`, `--allow-paid`, `ANTHROPIC_API_KEY`, and an explicit model (`ANTHROPIC_MODEL` or `--model`). A key in the environment alone cannot enable live inference.

```sh
# Supply the key securely through your shell; never put it in a command or artifact.
node --import=tsx scripts/benchmark-generations.mjs \
  --mode provider --provider anthropic --allow-paid --model YOUR_CONFIGURED_MODEL \
  --scenario all --samples 3 --warmup 0 --concurrency 1 \
  --output /tmp/generation-before-live-provider.json
```

Use the production configured model for the first baseline. Do not change quality, card count, validation or model and attribute the entire difference to queue optimization. A live queue benchmark uses the same opt-in together with the dedicated local PostgreSQL target. The harness never accepts generated cards, captures user tokens, creates production decks, or changes deployed worker settings. Deployment remains CI/CD only.

Live samples also contain bounded diagnostics: HTTP status, an allowlisted stop reason, provider token counts, and validation issue codes/field paths. These help distinguish output truncation or format rejection from queue delay. Diagnostics reuse the adapter's parsed response and do not log provider text, validation messages, or supplied values. Reported token totals include available usage from rejected responses; network failures may have unknown usage.
