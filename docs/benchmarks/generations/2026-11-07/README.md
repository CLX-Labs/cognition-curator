# Generation performance sprint: initial baseline

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

See [benchmark instructions](../../../generation-performance.md) for definitions and reproduction commands. Official references: [pg-boss workers](https://github.com/timgit/pg-boss/blob/master/docs/api/workers.md), [Anthropic latency guidance](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-latency). The installed, pinned pg-boss source determines the options used by this branch.
