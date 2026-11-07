import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseOptions, percentile, SCENARIOS, summarize, validateBenchmarkDatabase } from './benchmark-generations.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('benchmark defaults are synthetic and bound workload', () => {
  const options = parseOptions([]);
  assert.equal(options.provider, 'fake');
  assert.equal(options.mode, 'queue');
  assert.equal(options.samples, 5);
  assert.equal(options.concurrency, 1);
  assert.equal(options.allowPaid, false);
  for (const args of [
    ['--samples', '101'], ['--samples', '0'], ['--concurrency', '11'],
    ['--warmup', '-1'], ['--fake-delay-ms', '30001'], ['--samples', '1.5'],
    ['--timeout-ms', 'NaN'], ['--scenario', 'private-topic'], ['--unknown'],
  ]) assert.throws(() => parseOptions(args));
});

test('live inference requires explicit paid opt in', () => {
  assert.throws(() => parseOptions(['--provider', 'anthropic']), /allow-paid/u);
  assert.equal(parseOptions(['--provider', 'anthropic', '--allow-paid']).provider, 'anthropic');
});

test('embedded mode rejects parallel transactions that it cannot model accurately', () => {
  assert.throws(() => parseOptions(['--mode', 'embedded', '--concurrency', '2']), /real PostgreSQL/u);
});

test('queue database guard rejects remote, ambiguous and non-benchmark targets', () => {
  const allowed = 'postgresql://synthetic@127.0.0.1:59432/recollect_generation_benchmark_after';
  assert.equal(validateBenchmarkDatabase(allowed), allowed);
  for (const url of [
    undefined, 'invalid', 'postgres://user@db.example.com/recollect_generation_benchmark',
    'postgres://user@127.0.0.1/production', 'postgres://user@127.0.0.1/recollect_benchmark?host=db.example.com',
    'https://127.0.0.1/recollect_benchmark', 'postgres://user@127.0.0.1/postgres',
  ]) assert.throws(() => validateBenchmarkDatabase(url));
});

test('nearest rank percentiles preserve small sample tails', () => {
  assert.equal(percentile([], 0.95), null);
  assert.equal(percentile([100, 1, 10, 50], 0.5), 10);
  assert.equal(percentile([100, 1, 10, 50], 0.95), 100);
  assert.equal(percentile([5], 0.95), 5);
});

test('failed requests count toward error rate but do not bias successful latency', () => {
  const report = summarize([
    { status: 'succeeded', attempts: 1, totalMs: 100, providerMs: 30, inputTokens: 2, outputTokens: 3 },
    { status: 'failed', attempts: 3, totalMs: 9000, providerMs: 20, inputTokens: 1, outputTokens: 1 },
    { status: 'succeeded', attempts: 1, totalMs: 200, providerMs: 30, inputTokens: 2, outputTokens: 3 },
  ]);
  assert.equal(report.samples, 3);
  assert.equal(report.succeeded, 2);
  assert.equal(report.errorRate, 1 / 3);
  assert.equal(report.attempts, 5);
  assert.equal(report.metrics.totalMs.p50, 100);
  assert.equal(report.metrics.totalMs.p95, 200);
  assert.equal(report.metrics.queueWaitMs.p50, null);
  assert.equal(report.inputTokens, 5);
});

test('synthetic smoke excludes warmups and never prints fixture content or inherited secrets', () => {
  const secret = 'never-print-this-synthetic-secret';
  const result = spawnSync(process.execPath, [
    '--import=tsx', 'scripts/benchmark-generations.mjs', '--mode', 'provider',
    '--scenario', 'answer', '--samples', '2', '--warmup', '1', '--fake-delay-ms', '1',
  ], {
    cwd: root, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, ANTHROPIC_API_KEY: secret, DATABASE_URL: `postgres://${secret}@production/real` },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.summary.samples, 2);
  assert.equal(report.summary.attempts, 2);
  assert.equal(report.warmupSummary.samples, 1);
  assert.equal(report.metadata.provider, 'fake');
  assert.equal(report.metadata.model, 'synthetic-fixed-delay');
  assert.equal(report.samples.length, 2);
  assert.equal(report.summary.inputTokens, 0);
  assert.equal(report.metadata.sourceHashes['apps/worker/src/worker.ts'].length, 64);
  assert.ok(!result.stdout.includes(secret));
  for (const { prompt } of Object.values(SCENARIOS)) assert.ok(!result.stdout.includes(prompt));
  assert.ok(!result.stdout.includes('A concise synthetic benchmark definition.'));
});

test('artifact preflight blocks existing files and symlinks before any live fetch', () => {
  const directory = mkdtempSync(join(tmpdir(), 'recollect-benchmark-preflight-'));
  try {
    const artifact = join(directory, 'baseline.json');
    const sentinel = join(directory, 'fetch-called');
    const dangling = join(directory, 'dangling.json');
    writeFileSync(artifact, 'preserve this baseline');
    symlinkSync(join(directory, 'missing.json'), dangling);
    const intercept = `import { writeFileSync } from 'node:fs'; globalThis.fetch = async () => { writeFileSync(process.env.BENCHMARK_FETCH_SENTINEL, 'called'); throw new Error('no network in this test'); };`;
    for (const output of [artifact, dangling]) {
      const result = spawnSync(process.execPath, [
        '--import=data:text/javascript,' + encodeURIComponent(intercept), '--import=tsx',
        'scripts/benchmark-generations.mjs', '--mode', 'provider', '--provider', 'anthropic',
        '--allow-paid', '--model', 'synthetic-test-model', '--scenario', 'answer',
        '--samples', '1', '--warmup', '0', '--output', output,
      ], {
        cwd: root, encoding: 'utf8', timeout: 15000,
        env: { ...process.env, ANTHROPIC_API_KEY: 'synthetic-key-no-real-inference', BENCHMARK_FETCH_SENTINEL: sentinel },
      });
      assert.equal(result.status, 1);
      assert.equal(existsSync(sentinel), false);
      assert.equal(readFileSync(artifact, 'utf8'), 'preserve this baseline');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
