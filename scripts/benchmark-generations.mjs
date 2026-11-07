import { execFileSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export const SCENARIOS = Object.freeze({
  answer: { count: 1, mode: 'answer', prompt: 'Who wrote Pride and Prejudice?' },
  cards5: { count: 5, mode: 'cards', prompt: 'Beginner Italian vocabulary for ordering food' },
  cards10: { count: 10, mode: 'cards', prompt: 'Introductory human anatomy: major organ functions' },
});

const DEFAULTS = Object.freeze({
  mode: 'queue', provider: 'fake', scenario: 'all', samples: 5, warmup: 1,
  concurrency: 1, fakeDelayMs: 300, timeoutMs: 120000, output: null, model: null,
  allowPaid: false, submissionGapMs: 0,
});

export function parseOptions(args) {
  const options = { ...DEFAULTS };
  const strings = new Map([
    ['--mode', 'mode'], ['--provider', 'provider'], ['--scenario', 'scenario'],
    ['--output', 'output'], ['--model', 'model'],
  ]);
  const numbers = new Map([
    ['--samples', ['samples', 1, 100]], ['--warmup', ['warmup', 0, 10]],
    ['--concurrency', ['concurrency', 1, 10]], ['--fake-delay-ms', ['fakeDelayMs', 0, 30000]],
    ['--timeout-ms', ['timeoutMs', 1000, 300000]],
    ['--submission-gap-ms', ['submissionGapMs', 0, 30000]],
  ]);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help') return { help: true };
    if (arg === '--allow-paid') { options.allowPaid = true; continue; }
    if (!strings.has(arg) && !numbers.has(arg)) throw new Error(`Unknown option: ${arg}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    if (strings.has(arg)) options[strings.get(arg)] = value;
    else {
      const [name, minimum, maximum] = numbers.get(arg);
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
        throw new Error(`${arg} must be an integer between ${minimum} and ${maximum}.`);
      options[name] = parsed;
    }
  }
  if (!['provider', 'embedded', 'queue'].includes(options.mode)) throw new Error('Invalid --mode.');
  if (!['fake', 'anthropic'].includes(options.provider)) throw new Error('Invalid --provider.');
  if (options.scenario !== 'all' && !SCENARIOS[options.scenario]) throw new Error('Invalid --scenario.');
  if (options.provider === 'anthropic' && !options.allowPaid)
    throw new Error('Live inference requires --provider anthropic --allow-paid.');
  if (options.mode === 'embedded' && options.concurrency !== 1)
    throw new Error('Embedded mode supports concurrency 1 only; use real PostgreSQL for queue/load benchmarks.');
  return options;
}

export function validateBenchmarkDatabase(value) {
  if (!value) throw new Error('Queue mode requires BENCHMARK_DATABASE_URL pointing to a fresh local benchmark database.');
  let url;
  try { url = new URL(value); } catch { throw new Error('BENCHMARK_DATABASE_URL is invalid.'); }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !/^recollect_[a-z0-9_]*benchmark[a-z0-9_]*$/u.test(database) || url.search)
    throw new Error('Use a loopback PostgreSQL URL with a database named recollect_*benchmark*. Query parameters are not allowed.');
  return value;
}

export function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
function rounded(value) { return Number.isFinite(value) ? Math.round(value * 100) / 100 : null; }
export function summarize(samples) {
  const succeeded = samples.filter((sample) => sample.status === 'succeeded');
  const metrics = {};
  for (const name of ['enqueueMs', 'queueWaitMs', 'providerMs', 'completionObserveMs', 'totalMs']) {
    const values = succeeded.map((sample) => sample[name]).filter(Number.isFinite);
    metrics[name] = {
      samples: values.length, p50: rounded(percentile(values, 0.5)), p95: rounded(percentile(values, 0.95)),
      min: rounded(values.length ? Math.min(...values) : null),
      max: rounded(values.length ? Math.max(...values) : null),
      mean: rounded(values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null),
    };
  }
  return {
    samples: samples.length, succeeded: succeeded.length, failed: samples.length - succeeded.length,
    errorRate: samples.length ? (samples.length - succeeded.length) / samples.length : 0,
    attempts: samples.reduce((total, sample) => total + sample.attempts, 0),
    inputTokens: samples.reduce((total, sample) => total + (sample.inputTokens ?? 0), 0),
    outputTokens: samples.reduce((total, sample) => total + (sample.outputTokens ?? 0), 0),
    metrics,
  };
}

async function makeDatabase(options) {
  const [{ createDatabase }, { migrate }] = await Promise.all([
    import('../packages/db/src/index.ts'), import('../packages/db/src/migrate.ts'),
  ]);
  let embedded, server;
  let url;
  if (options.mode === 'embedded') {
    const [{ PGlite }, { pgcrypto }, { PGLiteSocketServer }] = await Promise.all([
      import('@electric-sql/pglite'), import('@electric-sql/pglite/contrib/pgcrypto'),
      import('@electric-sql/pglite-socket'),
    ]);
    embedded = await PGlite.create({ extensions: { pgcrypto } });
    server = new PGLiteSocketServer({ db: embedded, port: 0, host: '127.0.0.1', maxConnections: 10 });
    await server.start();
    url = `postgresql://postgres:postgres@${server.getServerConn()}/postgres`;
  } else url = validateBenchmarkDatabase(process.env.BENCHMARK_DATABASE_URL);
  const db = createDatabase(url);
  try {
    const existing = await db.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('recollect','recollect_boss')");
    if (existing.rowCount) throw new Error('Benchmark database is not fresh: recollect schemas already exist. Create another empty benchmark database.');
    await migrate(db);
  } catch (error) {
    await db.end(); await server?.stop(); await embedded?.close(); throw error;
  }
  return {
    db, url,
    close: async () => { await db.end(); await server?.stop(); await embedded?.close(); },
  };
}

export async function runBenchmark(options) {
  // No .env file is loaded, and DATABASE_URL is intentionally never consulted.
  let commit = 'unknown';
  let dirty = null;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    dirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch { /* Allows an unpacked source checkout. */ }
  const sourceHashes = Object.fromEntries(await Promise.all([
    'scripts/benchmark-generations.mjs', 'apps/worker/src/worker.ts',
    'apps/worker/src/config.ts', 'apps/worker/src/setup.ts',
    'packages/ai/src/index.ts', 'apps/api/src/generations.ts',
  ].map(async (path) => {
    try {
      return [path, createHash('sha256').update(await readFile(new URL('../' + path, import.meta.url))).digest('hex')];
    } catch (error) {
      if (path === 'apps/worker/src/config.ts' && error.code === 'ENOENT') return [path, null];
      throw error;
    }
  })));
  let resolvedWorkerConfig = null;
  if (options.mode === 'queue' && sourceHashes['apps/worker/src/config.ts']) {
    const { resolveWorkerConfig } = await import('../apps/worker/src/config.ts');
    resolvedWorkerConfig = resolveWorkerConfig();
  }
  const { AnthropicProvider, ProviderError, generatedCardSchema } = await import('../packages/ai/src/index.ts');
  const callContext = new AsyncLocalStorage();
  const diagnosticFetch = async (...args) => {
    const response = await fetch(...args);
    const context = callContext.getStore();
    if (!context) return response;
    context.diagnostic.httpStatus = response.status;
    const originalJson = response.json.bind(response);
    // Observe the same parsed envelope, rather than copying or changing the request/response body.
    Object.defineProperty(response, 'json', { value: async () => {
      const envelope = await originalJson();
      const reasons = ['end_turn', 'max_tokens', 'stop_sequence', 'tool_use', 'pause_turn', 'refusal', 'model_context_window_exceeded'];
      context.diagnostic.stopReason = reasons.includes(envelope?.stop_reason) ? envelope.stop_reason : 'other';
      for (const [target, key] of [['inputTokens', 'input_tokens'], ['outputTokens', 'output_tokens']]) {
        const value = envelope?.usage?.[key];
        if (Number.isSafeInteger(value) && value >= 0) context.diagnostic[target] = value;
      }
      const tool = Array.isArray(envelope?.content)
        ? envelope.content.find((block) => block?.type === 'tool_use' && block?.name === 'emit_flashcards')
        : null;
      const cards = tool?.input?.cards;
      const issues = [];
      if (!Array.isArray(cards)) issues.push({ code: 'missing_cards', path: ['cards'] });
      else {
        if (cards.length !== context.count) issues.push({ code: 'card_count', path: ['cards'] });
        for (const [index, card] of cards.entries()) {
          const parsed = generatedCardSchema.safeParse(card);
          if (!parsed.success) for (const issue of parsed.error.issues) {
            const path = issue.path.map((part) => typeof part === 'number' || ['front', 'back', 'hint', 'explanation', 'tags'].includes(part) ? part : 'field');
            issues.push({ code: issue.code, path: ['cards', index, ...path] });
          }
        }
      }
      if (issues.length) context.diagnostic.validationIssues = issues.slice(0, 100);
      return envelope;
    } });
    return response;
  };
  const model = options.provider === 'fake' ? 'synthetic-fixed-delay' : options.model ?? process.env.ANTHROPIC_MODEL;
  if (options.provider === 'anthropic' && (!process.env.ANTHROPIC_API_KEY || !model))
    throw new Error('Explicit live mode also requires ANTHROPIC_API_KEY and ANTHROPIC_MODEL or --model.');
  const underlying = options.provider === 'fake' ? {
    async generate(input) {
      const started = performance.now();
      await delay(options.fakeDelayMs);
      return {
        cards: Array.from({ length: input.count }, (_, index) => ({
          front: `Concept ${index + 1}`, back: 'A concise synthetic benchmark definition.',
          hint: 'Synthetic hint', explanation: '', tags: ['benchmark'],
        })),
        usage: { model, inputTokens: 0, outputTokens: 0, durationMs: Math.round(performance.now() - started), promptVersion: 'synthetic-v1' },
      };
    },
  } : new AnthropicProvider(process.env.ANTHROPIC_API_KEY, model, Math.min(90000, options.timeoutMs), diagnosticFetch);
  const pending = new Map();
  const observedProvider = {
    async generate(input) {
      const record = pending.get(input.prompt);
      if (!record) throw new Error('Unrecognized synthetic benchmark request.');
      const started = performance.now();
      record.firstProviderAt ??= started;
      record.attempts++;
      record.providerActive = true;
      const diagnostic = {};
      try {
        const result = await callContext.run({ diagnostic, count: input.count }, () => underlying.generate(input));
        record.inputTokens = (record.inputTokens ?? 0) + result.usage.inputTokens;
        record.outputTokens = (record.outputTokens ?? 0) + result.usage.outputTokens;
        record.promptVersion = result.usage.promptVersion;
        return result;
      } catch (error) {
        record.inputTokens = (record.inputTokens ?? 0) + (diagnostic.inputTokens ?? 0);
        record.outputTokens = (record.outputTokens ?? 0) + (diagnostic.outputTokens ?? 0);
        record.errorCode = error instanceof ProviderError ? error.code : 'provider_error';
        throw error;
      } finally {
        const ended = performance.now();
        record.providerMs += ended - started;
        record.lastProviderAt = ended;
        record.providerActive = false;
        if (options.provider === 'anthropic') (record.providerDiagnostics ??= []).push(diagnostic);
      }
    },
  };
  const startedAt = new Date().toISOString();
  let database, workerStop, service, owner, deckId;
  const samples = [], warmups = [], scenarioDurations = {};
  let databaseVersion = null;
  try {
    if (options.mode !== 'provider') {
      database = await makeDatabase(options);
      databaseVersion = (await database.db.query('SHOW server_version')).rows[0].server_version;
      const { GenerationService } = await import('../apps/api/src/generations.ts');
      owner = randomUUID(); deckId = randomUUID();
      await database.db.query('INSERT INTO recollect.users(id,email,name) VALUES($1,$2,$3)', [owner, 'benchmark@example.test', 'Synthetic benchmark']);
      await database.db.query('INSERT INTO recollect.decks(owner_id,id,data) VALUES($1,$2,$3)', [owner, deckId, {
        id: deckId, ownerId: owner, name: 'Synthetic benchmark', description: '', color: '#112233',
        icon: '', isSilenced: false, silencedUntil: null, version: 1,
        createdAt: startedAt, updatedAt: startedAt, deletedAt: null,
      }]);
      service = new GenerationService(database.db, 1000000, false);
      if (options.mode === 'queue') {
        const { setupQueue } = await import('../apps/worker/src/setup.ts');
        const { startWorker } = await import('../apps/worker/src/worker.ts');
        await setupQueue(database.url);
        workerStop = await startWorker(database.db, database.url, observedProvider);
      }
    }
    const scenarios = options.scenario === 'all' ? Object.keys(SCENARIOS) : [options.scenario];
    async function execute(scenario, index, warmup) {
      const fixture = SCENARIOS[scenario];
      const record = { scenario, sample: index + 1, warmup, count: fixture.count, mode: fixture.mode, status: 'pending', attempts: 0, providerMs: 0 };
      // Stable, synthetic request identifiers correlate concurrent calls without recording prompts or job/user IDs.
      const prompt = `${fixture.prompt}\nBenchmark fixture ${warmup ? 'warmup' : 'sample'} ${index + 1}.`;
      pending.set(prompt, record);
      const started = performance.now();
      let enqueued = started;
      try {
        if (options.mode === 'provider') {
          await observedProvider.generate({ prompt, count: fixture.count });
          record.status = 'succeeded';
        } else {
          const job = await service.create(owner, { operationId: randomUUID(), deckId, prompt, count: fixture.count, mode: fixture.mode });
          enqueued = performance.now();
          if (options.mode === 'embedded') {
            const { dispatchPending, runGeneration } = await import('../apps/worker/src/worker.ts');
            const dispatched = [];
            await dispatchPending(database.db, async (id) => { dispatched.push(id); });
            for (const id of dispatched) await runGeneration(database.db, observedProvider, id);
          }
          while (performance.now() - started < options.timeoutMs) {
            const result = await database.db.query('SELECT status,attempt,error FROM recollect.generation_jobs WHERE id=$1', [job.id]);
            const state = result.rows[0];
            if (['succeeded', 'failed', 'canceled'].includes(state.status)) {
              record.status = state.status;
              if (state.status === 'succeeded') delete record.errorCode;
              else record.errorCode = state.error?.code ?? record.errorCode;
              record.attempts = state.attempt;
              break;
            }
            await delay(20);
          }
          if (record.status === 'pending') { record.status = 'failed'; record.errorCode = 'benchmark_deadline'; }
        }
      } catch (error) {
        record.status = 'failed';
        record.errorCode = error instanceof ProviderError ? error.code : 'benchmark_error';
      } finally {
        const finished = performance.now();
        if (record.providerActive)
          record.providerInFlightAtDeadline = true;
        record.enqueueMs = rounded(enqueued - started);
        record.queueWaitMs = rounded(record.firstProviderAt === undefined ? null : Math.max(0, record.firstProviderAt - enqueued));
        record.providerMs = rounded(record.providerMs);
        record.completionObserveMs = rounded(record.lastProviderAt === undefined ? null : Math.max(0, finished - record.lastProviderAt));
        record.totalMs = rounded(finished - started);
        delete record.firstProviderAt; delete record.lastProviderAt; delete record.providerActive;
        pending.delete(prompt);
      }
      // An in-flight provider may finish while graceful worker shutdown drains. Preserve
      // the observed deadline snapshot rather than mutating a failed artifact afterward.
      return structuredClone(record);
    }
    for (const scenario of scenarios) {
      // Warmups are sequential and excluded. The production worker remains warm between all samples.
      for (let index = 0; index < options.warmup; index++) warmups.push(await execute(scenario, index, true));
      const scenarioStarted = performance.now();
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(options.concurrency, options.samples) }, async () => {
        while (next < options.samples) {
          const index = next++;
          if (options.submissionGapMs) await delay(options.submissionGapMs);
          samples.push(await execute(scenario, index, false));
        }
      }));
      scenarioDurations[scenario] = performance.now() - scenarioStarted;
    }
    return {
      schemaVersion: 1,
      metadata: {
        startedAt, completedAt: new Date().toISOString(), commit, trackedChanges: dirty, sourceHashes,
        node: process.version, platform: process.platform, architecture: process.arch,
        mode: options.mode, provider: options.provider, model, scenarioSet: 'generation-fixtures-v1',
        samplesPerScenario: options.samples, warmupPerScenario: options.warmup,
        clientConcurrency: options.concurrency, fakeDelayMs: options.provider === 'fake' ? options.fakeDelayMs : null,
        submissionGapMs: options.submissionGapMs,
        timeoutMs: options.timeoutMs, observeIntervalMs: options.mode === 'provider' ? null : 20,
        database: options.mode === 'queue' ? 'dedicated-local-postgresql' : options.mode === 'embedded' ? 'ephemeral-pglite' : null,
        databaseVersion,
        resolvedWorkerConfig,
        pgBossVersion: options.mode === 'queue' ? JSON.parse(await readFile(new URL('../node_modules/pg-boss/package.json', import.meta.url), 'utf8')).version : null,
        scope: options.mode === 'queue' ? 'GenerationService + production startWorker + pg-boss + persistence' : options.mode === 'embedded' ? 'GenerationService + direct outbox dispatch + runGeneration + persistence; excludes pg-boss and dispatch/poll timers' : 'provider adapter only; excludes API, queue and database',
      },
      summary: summarize(samples),
      scenarios: Object.fromEntries(scenarios.map((scenario) => {
        const report = summarize(samples.filter((sample) => sample.scenario === scenario));
        return [scenario, { ...report, wallDurationMs: rounded(scenarioDurations[scenario]),
          successfulRequestsPerSecond: rounded(report.succeeded / (scenarioDurations[scenario] / 1000)) }];
      })),
      warmupSummary: summarize(warmups),
      samples: samples.sort((a, b) => a.scenario.localeCompare(b.scenario) || a.sample - b.sample),
    };
  } finally {
    await workerStop?.();
    await database?.close();
  }
}

const HELP = `Generation latency benchmark (Node 24, run with --import=tsx)

Default: fake provider, real production queue, fresh local benchmark PostgreSQL only.
No .env is loaded and DATABASE_URL is never used. No paid API calls occur by default.

--mode queue|embedded|provider    Default queue; embedded is a direct smoke check
--provider fake|anthropic       Live calls also require --allow-paid
--scenario all|answer|cards5|cards10
--samples 1..100                Measured samples per scenario (default 5)
--warmup 0..10                  Excluded warmup samples per scenario (default 1)
--concurrency 1..10             Concurrent client jobs (default 1)
--fake-delay-ms 0..30000         Synthetic provider delay (default 300)
--submission-gap-ms 0..30000     Delay before each measured request in each lane
--timeout-ms 1000..300000        Per-sample observed deadline (default 120000)
--model MODEL                   Live model, otherwise ANTHROPIC_MODEL
--output PATH                   Write JSON; otherwise print JSON to stdout

Queue mode requires BENCHMARK_DATABASE_URL. Use a fresh empty loopback database
named recollect_*benchmark*; setup never drops or resets existing schemas.
Live mode requires ANTHROPIC_API_KEY, a model, --provider anthropic --allow-paid.
Prompts, cards, credentials, database URLs and account/job IDs are never recorded.
`;

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) { process.stdout.write(HELP); return; }
  let outputHandle;
  try {
    if (options.output) {
      const destination = resolve(options.output);
      await mkdir(dirname(destination), { recursive: true });
      // Reserve an exclusive private artifact before any provider or database work.
      // Existing files, symlinks and unwritable destinations fail without inference.
      outputHandle = await open(destination, 'wx', 0o600);
    }
    const report = await runBenchmark(options);
    const json = JSON.stringify(report, null, 2) + '\n';
    if (outputHandle) {
      await outputHandle.writeFile(json);
      process.stdout.write(`Benchmark JSON saved (${report.summary.succeeded}/${report.summary.samples} succeeded).\n`);
    } else process.stdout.write(json);
    if (report.summary.failed || report.warmupSummary.failed) process.exitCode = 1;
  } finally {
    await outputHandle?.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Driver and provider errors can contain connection strings or response content.
    process.stderr.write('Benchmark could not complete. Check CLI options, required configuration, and a fresh local database. No error payload was logged.\n');
    process.exitCode = 1;
  });
}
