import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createReleaseMetadata, prepareRelease } from './release-metadata.mjs';

const env = { GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_NUMBER: '14', GITHUB_RUN_ATTEMPT: '1',
  GITHUB_RUN_ID: '123', GITHUB_REPOSITORY: 'CLX-Labs/cognition-curator' };

test('release identity pins the commit and distinguishes re-runs', () => {
  const first = createReleaseMetadata(env, new Date('2026-10-11T12:00:00Z'));
  assert.equal(first.id, 'r14.1-aaaaaaa');
  assert.equal(first.commit, env.GITHUB_SHA);
  assert.equal(first.version, null);
  assert.equal(first.apiUrl, null);
  assert.equal(createReleaseMetadata({ ...env, API_URL: 'https://api.example.com' }).apiUrl, 'https://api.example.com');
  assert.equal(createReleaseMetadata({ ...env, RELEASE_VERSION: '2.1.0' }).version, '2.1.0');
  assert.throws(() => createReleaseMetadata({ ...env, RELEASE_VERSION: '2.1.0\nother=bad' }));
  assert.equal(first.createdAt, '2026-10-11T12:00:00.000Z');
  assert.equal(createReleaseMetadata({ ...env, GITHUB_RUN_ATTEMPT: '2' }).id, 'r14.2-aaaaaaa');
  assert.equal(createReleaseMetadata({ ...env, GITHUB_RUN_NUMBER: '15' }).id, 'r15.1-aaaaaaa');
});

test('missing or malformed identity fails before an untraceable release is produced', () => {
  for (const key of Object.keys(env)) assert.throws(() => createReleaseMetadata({ ...env, [key]: '' }));
  assert.throws(() => createReleaseMetadata({ ...env, GITHUB_SHA: 'main' }));
  assert.throws(() => createReleaseMetadata({ ...env, GITHUB_RUN_ATTEMPT: '0' }));
  assert.throws(() => createReleaseMetadata({ ...env, GITHUB_RUN_NUMBER: '14\nother=oops' }));
});

test('the bundle stamp, workflow output and human release summary carry the same identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'recollect-release-'));
  try {
    const file = join(dir, 'release-info.json');
    const output = join(dir, 'output');
    const summary = join(dir, 'summary');
    await writeFile(file, '{}');
    const metadata = await prepareRelease({ ...env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary }, file);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), metadata);
    assert.equal(await readFile(output, 'utf8'), `release_id=${metadata.id}\n`);
    assert.match(await readFile(summary, 'utf8'), /r14\.1-aaaaaaa/);
    assert.match(await readFile(summary, 'utf8'), /not deployment success/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
