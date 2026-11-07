# Generation performance sprint: baseline and first comparison

Measured on 7 November 2026 UTC, against backend code from `8da51a79ce298c2abf9ac4305593f076e48e8949`. These files preserve the before measurements; do not replace them when collecting an after run.

## Controlled queue baseline

The benchmark exercises `GenerationService.create` → the running production worker's dispatch timer → pg-boss delivery → provider → persisted result. It uses a disposable local PostgreSQL 14.20 server, Node 24.22.2, pg-boss 12.37.1, and a fixed-delay synthetic provider on a Mac with Apple silicon. No production database is used. One warmup per workload is excluded from the results.

| Workload | Requests | Client concurrency | Provider delay | Total p50 | Total p95 | Queue wait mean | Success |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Consecutive five-card requests | 20 | 1 | 300 ms | 2,017 ms | 4,014 ms | 2,684 ms | 20/20 |
| Five-card burst | 24 | 6 | 2,000 ms | 12,044 ms | 14,035 ms | 9,773 ms | 24/24 |

The burst's measured workload took 52.18 seconds, or 0.46 successful requests/second. All measured queue requests completed on their first attempt. The provider delay is synthetic, so these are queue comparisons, not predictions of real AI completion time.

The observer queries local persisted status every 20 ms. The benchmark excludes mobile polling, rendering, HTTP transit and authentication. In the shipping app, the existing 2.5-second status polling interval adds another variable delay after backend completion.

Raw files: [serial](baseline-queue-serial.json), [burst](baseline-queue-burst.json). Source hashes are included in the burst artifact. The initial serial artifact predates the harness's additional source-hash/version/throughput metadata; the backend remained unchanged throughout all before runs.

## Live provider baseline

Nine explicit paid requests used the configured `claude-sonnet-4-6` provider with the existing prompts and schema. Requests were sequential and used only fixed synthetic fixtures; no production decks or cards were created. Each scenario has only three samples, so these are preliminary timings rather than reliable tail estimates.

| Scenario | Requests | Provider median | Range | Schema-valid results |
| --- | ---: | ---: | ---: | ---: |
| Single answer | 3 | 3.10 s | 2.94–3.17 s | 3/3 |
| Five cards | 3 | 12.92 s | 12.37–14.06 s | 3/3 |
| Ten cards | 3 | 21.75 s | 19.71–21.95 s | 3/3 |

The adapter checks count, fields and short concept-title constraints. This is not a factual accuracy evaluation. Recorded usage totals are 9,618 input tokens and 6,996 output tokens. The artifact contains timings and usage, not generated content or credentials: [live provider](baseline-provider-sonnet.json).

## Production evidence and first optimization target

A read-only inspection of recent logs found a generation that failed with `invalid_output` after 91.3 seconds and another that returned to the queue with that error. This selected log sample has no representative denominator and must not be treated as a production failure-rate estimate. Successful observed jobs and low CPU/memory utilization suggest investigating dispatch latency, serialized inference and validation retries before adding server capacity.

The first comparison keeps the provider, prompts, validation, leases, retry policy and token charging behavior unchanged. It targets dispatch/poll delays, bounded worker concurrency and stage timing visibility. Invalid-output diagnosis and model/output experiments remain separate work so a queue improvement is not confused with a quality or model change.

## First comparison

The optimized worker uses two consumers instead of one, a 500 ms dispatch interval instead of 3,000 ms, and explicit 500 ms queue polling instead of the pg-boss 2,000 ms default. Recovery runs separately every 30 seconds instead of on every dispatch tick. Every setting has a bounded operational override. No provider requests, prompts, output validation, retry delays, leases, token rules, queue schema, or mobile code changed.

Both after runs use the same machine, PostgreSQL version, scenarios, request counts, concurrency, fixed provider delays and 20 ms observation interval as their before run. The artifacts record the modified source hashes and `trackedChanges: true` because measurements were collected before committing the optimization; the provider/API hashes match the before artifacts. The harness acquired additional metadata/diagnostic safeguards during this sprint, so its hash differs from the initial before runs. Those changes do not replace the queue path being measured.

| Workload | Metric | Before | After | Reduction |
| --- | --- | ---: | ---: | ---: |
| Consecutive requests, 300 ms provider | Total p50 | 2,017 ms | 999 ms | 50.5% |
| Consecutive requests, 300 ms provider | Total p95 | 4,014 ms | 1,015 ms | 74.7% |
| Consecutive requests, 300 ms provider | Queue wait mean | 2,684 ms | 633 ms | 76.4% |
| Six-client burst, 2,000 ms provider | Total p50 | 12,044 ms | 6,016 ms | 50.0% |
| Six-client burst, 2,000 ms provider | Total p95 | 14,035 ms | 6,524 ms | 53.5% |
| Six-client burst, 2,000 ms provider | Workload duration | 52.18 s | 25.09 s | 51.9% |

All 44 measured after requests and both warmups succeeded on their first attempt, matching the before runs. Burst throughput rose from 0.46 to 0.96 successful requests/second. These are preliminary controlled local comparisons, not a measured production improvement or a reduction in the model's own inference duration. Production client polling and invalid-output retries remain possible sources of long waits.

Raw after files: [serial](after-queue-serial.json), [burst](after-queue-burst.json). Reproduce both workloads rather than comparing the synthetic provider results directly with the live-provider table.

Validation completed: all 706 tests across 67 files passed against a separate disposable real PostgreSQL database; all workspace/test TypeScript checks passed; all eight benchmark harness tests passed. The queue suite includes simultaneous duplicate deliveries with two consumers and verifies one provider call, as well as bounded concurrency, continued submissions, recovery, draining, and safe telemetry. No production deployment occurred during these measurements.

## Next measurements

1. Use the new attempt events after an eventual CI/CD deployment to compare real queue wait, provider time and validation retries. Keep prompts and generated content out of logs.
2. Diagnose invalid outputs by schema path and stop reason; do not relax validation or silently accept malformed cards to improve latency statistics. The explicit live benchmark records safe structural diagnostics.
3. Compare output/prompt changes or a faster model using identical fixtures, inference token usage and a separate factual-quality evaluation before changing the production model. The three live samples per scenario above are only a starting point.

See [benchmark instructions](../../../generation-performance.md) for definitions and reproduction commands. Official references: [pg-boss workers](https://github.com/timgit/pg-boss/blob/master/docs/api/workers.md), [Anthropic latency guidance](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-latency). The installed, pinned pg-boss source determines the options used by this branch.
