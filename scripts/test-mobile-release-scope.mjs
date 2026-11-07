import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { determineMobileRelease, createGitReader, mobileDependencySnapshot, rootManifestChanged,
  classifyChangedPaths, writeScopeResult } from './mobile-release-scope.mjs';

const rootManifest = { name: 'test', private: true, workspaces: ['apps/*', 'packages/*'],
  scripts: { test: 'node --test', benchmark: 'old' }, engines: { node: '>=24 <25' } };
const mobileManifest = { name: '@test/mobile', dependencies: { '@test/shared': '*', react: '1.0.0' },
  devDependencies: { typescript: '1.0.0' } };
const lockFixture = () => ({ lockfileVersion: 3, packages: {
  '': structuredClone(rootManifest),
  'apps/mobile': structuredClone(mobileManifest),
  'apps/api': { name: '@test/api', dependencies: { pg: '1.0.0' } },
  'packages/shared': { name: '@test/shared', dependencies: { zod: '1.0.0' } },
  'node_modules/@test/shared': { resolved: 'packages/shared', link: true },
  'node_modules/react': { version: '1.0.0', integrity: 'sha512-react', dependencies: { scheduler: '1.0.0' } },
  'node_modules/scheduler': { version: '1.0.0', integrity: 'sha512-scheduler' },
  'node_modules/typescript': { version: '1.0.0', integrity: 'sha512-ts' },
  'node_modules/zod': { version: '1.0.0', integrity: 'sha512-zod' },
  'node_modules/pg': { version: '1.0.0', integrity: 'sha512-pg' },
} });

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'recollect-mobile-scope-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = createGitReader(cwd);
  const put = async (path, value) => {
    await mkdir(dirname(join(cwd, path)), { recursive: true });
    await writeFile(join(cwd, path), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  };
  await git('init', '-q');
  await git('config', 'user.name', 'Release Scope Test');
  await git('config', 'user.email', 'release-scope@example.invalid');
  const commit = async () => {
    await git('add', '--all');
    await git('commit', '--quiet', '--allow-empty', '-m', 'Fixture update');
    return (await git('rev-parse', 'HEAD')).trim();
  };
  await put('package.json', rootManifest);
  await put('package-lock.json', lockFixture());
  await put('apps/mobile/package.json', mobileManifest);
  await put('apps/mobile/eas.json', { cli: { version: '>=1.0.0' }, build: { production: { channel: 'production' } },
    submit: { production: { ios: { ascAppId: '123' } } } });
  await put('apps/mobile/src/card.ts', 'export const card = 1;\n');
  await put('packages/shared/package.json', { name: '@test/shared', dependencies: { zod: '1.0.0' } });
  await put('packages/shared/src/index.ts', 'export const shared = 1;\n');
  const before = await commit();
  const env = { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_BEFORE: before };
  const scope = async (overrides = {}) => determineMobileRelease({ ...env, GITHUB_SHA: await commit(), ...overrides }, { run: git });
  return { cwd, git, put, commit, before, env, scope };
}

test('PR #50 worker/benchmark/script-only root manifest changes skip mobile releases for either branch type', async (t) => {
  const f = await fixture(t);
  const paths = [
    '.github/workflows/recollect-ci.yml', 'apps/worker/README.md', 'apps/worker/src/config.ts',
    'apps/worker/src/start.ts', 'apps/worker/src/worker.ts', 'apps/worker/test/config.test.ts',
    'apps/worker/test/queue.integration.test.ts', 'docs/benchmarks/generations/2026-11-07/README.md',
    'docs/benchmarks/generations/2026-11-07/after-queue-burst.json',
    'docs/benchmarks/generations/2026-11-07/after-queue-serial.json',
    'docs/benchmarks/generations/2026-11-07/baseline-provider-sonnet.json',
    'docs/benchmarks/generations/2026-11-07/baseline-queue-burst.json',
    'docs/benchmarks/generations/2026-11-07/baseline-queue-serial.json',
    'docs/generation-performance.md', 'scripts/benchmark-generations.mjs', 'scripts/test-benchmark-generations.mjs',
  ];
  for (const path of paths) await f.put(path, 'backend benchmark update\n');
  await f.put('package.json', { ...rootManifest, version: '9.0.0', description: 'updated',
    scripts: { ...rootManifest.scripts, benchmark: 'node scripts/benchmark-generations.mjs' } });
  for (const branch of ['enhancement/faster-generations', 'feature/backend-refactor']) {
    const result = await f.scope({ GITHUB_HEAD_REF: branch });
    assert.equal(result.releaseRequired, false);
  }
});

test('API, worker, DB, AI, website, docs and release-tool-only updates skip', async (t) => {
  const f = await fixture(t);
  for (const path of ['apps/api/src/index.ts', 'apps/worker/src/index.ts', 'packages/db/src/query.ts',
    'packages/ai/src/generate.ts', 'apps/landing/index.html', 'docs/release.md', 'AGENTS.md',
    'scripts/release-policy.mjs', '.github/workflows/recollect-release.yml',
    'apps/mobile/.eas/workflows/release.yml']) await f.put(path, 'changed');
  assert.equal((await f.scope()).releaseRequired, false);
});

test('EAS submit/CLI orchestration changes skip while build profile changes release', async (t) => {
  const f = await fixture(t);
  const config = { cli: { version: '>=99.0.0' }, build: { production: { channel: 'production' } },
    submit: { production: { ios: { ascAppId: '456' } } } };
  await f.put('apps/mobile/eas.json', config);
  assert.equal((await f.scope()).releaseRequired, false);
  config.build.production.channel = 'testflight';
  await f.put('apps/mobile/eas.json', config);
  assert.equal((await f.scope()).releaseRequired, true);
});

test('mobile app or assets mixed with backend changes require a mobile release', async (t) => {
  for (const path of ['apps/mobile/src/card.ts', 'apps/mobile/assets/icon.png',
    'apps/mobile/modules/billing/ios/Billing.swift', 'apps/mobile/app.config.ts', 'apps/mobile/eas.json']) {
    await t.test(path, async (t) => {
      const f = await fixture(t);
      await f.put('apps/api/src/index.ts', 'changed');
      await f.put(path, 'changed');
      assert.equal((await f.scope()).releaseRequired, true);
    });
  }
});

test('mobile/shared tests and documentation do not release but shared runtime changes do', async (t) => {
  const f = await fixture(t);
  for (const path of ['apps/mobile/test/cards.test.ts', 'apps/mobile/src/card.spec.tsx',
    'apps/mobile/README.md', 'apps/mobile/docs/flow.json', 'packages/shared/__tests__/index.ts',
    'packages/shared/src/index.test.ts', 'packages/shared/CHANGELOG.md']) await f.put(path, 'changed');
  assert.equal((await f.scope()).releaseRequired, false);
  await f.put('packages/shared/src/index.ts', 'changed');
  assert.equal((await f.scope()).releaseRequired, true);
});

test('root build configuration and install/EAS hooks release; ordinary scripts do not', async (t) => {
  for (const path of ['.npmrc', '.nvmrc', '.easignore', '.gitignore', '.gitattributes', 'tsconfig.base.json']) {
    await t.test(path, async (t) => {
      const f = await fixture(t);
      await f.put(path, 'changed');
      assert.equal((await f.scope()).releaseRequired, true);
    });
  }
  assert.equal(rootManifestChanged(rootManifest, { ...rootManifest, scripts: { test: 'new' } }), false);
  for (const name of ['install', 'preinstall', 'postinstall', 'prepare', 'prepublishOnly', 'eas-build-post-install'])
    assert.equal(rootManifestChanged(rootManifest, { ...rootManifest, scripts: { [name]: 'new' } }), true, name);
  for (const field of ['dependencies', 'overrides', 'engines', 'packageManager', 'workspaces'])
    assert.equal(rootManifestChanged(rootManifest, { ...rootManifest, [field]: 'new' }), true, field);
});

test('deleting mobile files and renaming them out of mobile scope still releases', async (t) => {
  const f = await fixture(t);
  await rm(join(f.cwd, 'apps/mobile/src/card.ts'));
  assert.equal((await f.scope()).releaseRequired, true);
  const g = await fixture(t);
  await mkdir(join(g.cwd, 'apps/api/src'), { recursive: true });
  await rename(join(g.cwd, 'apps/mobile/src/card.ts'), join(g.cwd, 'apps/api/src/card.ts'));
  assert.equal((await g.scope()).releaseRequired, true);
});

test('exact push range includes changes beyond 300 files and handles newline filenames safely', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 310; i++) await f.put(`apps/api/generated/file-${i}.ts`, 'changed');
  await f.put('apps/mobile/src/card\n::set-output name=release_required::false.ts', 'changed');
  const result = await f.scope();
  assert.equal(result.releaseRequired, true);
  assert.equal(result.reason.includes('set-output'), false);
});

test('manual dispatch forces a release on main without a before SHA; initial push inspects tree', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.scope({ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_EVENT_BEFORE: undefined })).releaseRequired, true);
  assert.equal((await f.scope({ GITHUB_EVENT_BEFORE: '0'.repeat(40) })).releaseRequired, true);
  await assert.rejects(f.scope({ GITHUB_REF: 'refs/heads/feature/test' }), /main/);
});

test('invalid, missing or unavailable commit history fails closed instead of returning skipped', async (t) => {
  const f = await fixture(t);
  for (const before of [undefined, 'HEAD~1', '-x', 'a'.repeat(40)])
    await assert.rejects(f.scope({ GITHUB_EVENT_BEFORE: before }));
  for (const sha of ['a', '0'.repeat(40), 'b'.repeat(40)]) await assert.rejects(f.scope({ GITHUB_SHA: sha }));
  await assert.rejects(f.scope({ GITHUB_EVENT_NAME: 'pull_request' }), /event/);
});

test('backend-only lock versions, integrity and install bookkeeping do not release', async (t) => {
  const f = await fixture(t);
  const lock = lockFixture();
  lock.packages['node_modules/pg'] = { version: '2.0.0', integrity: 'sha512-new', dependencies: { 'pg-parser': '1.0.0' } };
  lock.packages['node_modules/pg-parser'] = { version: '1.0.0' };
  lock.packages['apps/api'].dependencies.pg = '2.0.0';
  lock.packages['node_modules/react'].devOptional = true;
  await f.put('package-lock.json', lock);
  assert.equal((await f.scope()).releaseRequired, false);
});

test('reachable direct, transitive, dev and shared dependency versions/integrity require release', async (t) => {
  for (const path of ['node_modules/react', 'node_modules/scheduler', 'node_modules/typescript', 'node_modules/zod']) {
    await t.test(path, async (t) => {
      const f = await fixture(t);
      const lock = lockFixture();
      lock.packages[path].integrity = 'sha512-changed';
      await f.put('package-lock.json', lock);
      assert.equal((await f.scope()).releaseRequired, true);
    });
  }
});

test('nested hoisted resolutions and optional and peer dependencies are followed', async (t) => {
  const f = await fixture(t);
  const lock = lockFixture();
  lock.packages['node_modules/react/node_modules/scheduler'] = { version: '1.0.0', integrity: 'sha512-nested' };
  lock.packages['node_modules/react'].peerDependencies = { peer: '1.0.0', absent: '1.0.0' };
  lock.packages['node_modules/react'].peerDependenciesMeta = { absent: { optional: true } };
  lock.packages['node_modules/peer'] = { version: '1.0.0' };
  lock.packages['node_modules/react'].optionalDependencies = { optional: '1.0.0' };
  lock.packages['node_modules/optional'] = { version: '1.0.0' };
  const snapshot = mobileDependencySnapshot(lock);
  for (const path of ['node_modules/react/node_modules/scheduler', 'node_modules/peer', 'node_modules/optional'])
    assert.ok(snapshot.records[path], path);
  assert.equal(snapshot.records['node_modules/scheduler'], undefined);
  await f.put('package-lock.json', lock);
  assert.equal((await f.scope()).releaseRequired, true);
});

test('new transitive workspace dependencies are inferred and previous workspace removals remain visible', async (t) => {
  const f = await fixture(t);
  const lock = lockFixture();
  lock.packages['packages/shared'].dependencies['@test/future'] = '*';
  lock.packages['node_modules/@test/future'] = { link: true, resolved: 'packages/future' };
  lock.packages['packages/future'] = { name: '@test/future' };
  await f.put('package-lock.json', lock);
  await f.put('packages/future/src/index.ts', 'new');
  const after = await f.commit();
  assert.equal((await f.scope()).releaseRequired, true);
  await f.put('packages/future/src/index.ts', 'changed');
  assert.equal((await f.scope({ GITHUB_EVENT_BEFORE: after })).releaseRequired, true);
  await f.put('package-lock.json', lockFixture());
  assert.equal((await f.scope({ GITHUB_EVENT_BEFORE: after })).releaseRequired, true);
});

test('unsupported or incomplete lock data is rejected rather than allowing an unsafe skip', async (t) => {
  for (const lock of [{ lockfileVersion: 2, packages: {} }, {}, { lockfileVersion: 3, packages: {} }])
    assert.throws(() => mobileDependencySnapshot(lock), /lockfile/);
  const incomplete = lockFixture();
  delete incomplete.packages['node_modules/react'];
  assert.throws(() => mobileDependencySnapshot(incomplete), /missing/);
  const unsafe = lockFixture();
  unsafe.packages['node_modules/@test/shared'].resolved = '../outside';
  assert.throws(() => mobileDependencySnapshot(unsafe), /path/);
  const f = await fixture(t);
  await f.put('package-lock.json', '{');
  await assert.rejects(f.scope(), /valid/);
});

test('CLI result has only boolean output and a fixed summary without changed path content', async (t) => {
  const f = await fixture(t);
  const output = join(f.cwd, 'output');
  const summary = join(f.cwd, 'summary');
  await writeScopeResult({ releaseRequired: false, reason: 'No mobile changes.' },
    { GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary });
  assert.equal(await readFile(output, 'utf8'), 'release_required=false\n');
  assert.equal(await readFile(summary, 'utf8'), 'Mobile release: **skipped**. No mobile changes.\n');
  assert.equal(classifyChangedPaths(['apps/mobile-but-not/src/card.ts'], []), false);
});
