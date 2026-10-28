import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { dependencyArtifact, prepareIosDependencies } from './prepare-ios-dependencies.mjs';

const bytes = Buffer.from('complete official React Native artifact fixture');
const sha256 = createHash('sha256').update(bytes).digest('hex');
async function fixture(t, configuration = 'debug') {
  const cacheDir = await mkdtemp(join(tmpdir(), 'recollect-rn-prefetch-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  const calls = [];
  const logs = [];
  const options = { configuration, version: '0.86.3', cacheDir, pause: async () => {}, log: value => logs.push(value) };
  const run = async (command, args, limits) => {
    calls.push({ command, args, limits });
    assert.equal(command, 'curl');
    assert.equal(args[args.indexOf('--proto') + 1], '=https');
    assert.equal(args[args.indexOf('--proto-redir') + 1], '=https');
    assert.ok(limits.timeout <= 60_000 && limits.killSignal === 'SIGKILL');
    if (args.at(-1).endsWith('.sha256')) return { stdout: sha256 + '\n' };
    await writeFile(args[args.indexOf('--output') + 1], bytes);
    return { stdout: '' };
  };
  return { cacheDir, calls, logs, options, run };
}

test('prefetch uses the installed RN artifact layout, official checksum, and atomic verified cache file', async t => {
  const f = await fixture(t);
  const result = await prepareIosDependencies({ ...f.options, run: f.run });
  assert.equal(result.length, 1);
  assert.equal(result[0].sha256, sha256);
  assert.equal(result[0].downloaded, true);
  assert.equal(result[0].cachePath, join(f.cacheDir, 'reactnative-dependencies-0.86.3-debug.tar.gz'));
  assert.deepEqual(await readFile(result[0].cachePath), bytes);
  assert.equal(f.calls[0].args.at(-1), dependencyArtifact('0.86.3', 'debug').url + '.sha256');
  assert.equal(f.calls[1].args.at(-1), dependencyArtifact('0.86.3', 'debug').url);
  assert.deepEqual(await readdir(f.cacheDir), ['reactnative-dependencies-0.86.3-debug.tar.gz']);
});

test('a transient partial download is retried without exposing an incomplete final cache', async t => {
  const f = await fixture(t);
  let attempts = 0;
  const final = join(f.cacheDir, dependencyArtifact('0.86.3', 'debug').filename);
  await prepareIosDependencies({ ...f.options, run: async (command, args, limits) => {
    if (args.at(-1).endsWith('.sha256')) return f.run(command, args, limits);
    assert.equal(await access(final).then(() => true, () => false), false);
    if (++attempts === 1) {
      await writeFile(args[args.indexOf('--output') + 1], 'partial');
      throw new Error('curl timeout with sensitive redirect URL');
    }
    return f.run(command, args, limits);
  } });
  assert.equal(attempts, 2);
  assert.deepEqual(await readFile(final), bytes);
  assert.doesNotMatch(f.logs.join('\n'), /sensitive|redirect URL/);
});

test('bad checksums are bounded, remove corrupt previous cache, and never publish partial bytes', async t => {
  const f = await fixture(t);
  const final = join(f.cacheDir, dependencyArtifact('0.86.3', 'debug').filename);
  await writeFile(final, 'old corrupt cache');
  let attempts = 0;
  await assert.rejects(prepareIosDependencies({ ...f.options, run: async (command, args, limits) => {
    if (args.at(-1).endsWith('.sha256')) return f.run(command, args, limits);
    attempts++;
    await writeFile(args[args.indexOf('--output') + 1], 'wrong artifact');
    return { stdout: '' };
  } }), /failed after 3 bounded attempts/);
  assert.equal(attempts, 3);
  assert.deepEqual(await readdir(f.cacheDir), []);
});

test('missing or malformed checksum metadata fails before any archive download', async t => {
  const f = await fixture(t);
  let attempts = 0;
  await assert.rejects(prepareIosDependencies({ ...f.options, run: async (_command, args) => {
    assert.ok(args.at(-1).endsWith('.sha256'));
    attempts++;
    return { stdout: '<html>unavailable</html>' };
  } }), /SHA-256 metadata failed after 3 bounded attempts/);
  assert.equal(attempts, 3);
  assert.deepEqual(await readdir(f.cacheDir), []);
});

test('a verified existing cache is reused; all mode prepares both variants required by RN pods', async t => {
  const f = await fixture(t, 'all');
  const first = await prepareIosDependencies({ ...f.options, run: f.run });
  assert.deepEqual(first.map(item => item.configuration), ['debug', 'release']);
  f.calls.length = 0;
  const second = await prepareIosDependencies({ ...f.options, run: f.run });
  assert.equal(second.every(item => item.downloaded === false), true);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls.every(call => call.args.at(-1).endsWith('.sha256')), true);
});

test('invalid versions and configurations cannot construct arbitrary download URLs', async t => {
  const f = await fixture(t);
  for (const version of ['../../other', '0.86.3; echo bad', '0.86.3-nightly'])
    await assert.rejects(prepareIosDependencies({ ...f.options, version, run: f.run }), /stable React Native/);
  await assert.rejects(prepareIosDependencies({ ...f.options, configuration: 'other', run: f.run }), /configuration/);
  assert.deepEqual(f.calls, []);
});
