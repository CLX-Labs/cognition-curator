import assert from 'node:assert/strict';
import test from 'node:test';
import { releaseType, mergedBranch, planRelease, preparePolicy, recordRelease } from './release-policy.mjs';

const sha = 'a'.repeat(40);
const oldSha = 'b'.repeat(40);
const baseline = { version: '2.0.0', nativeVersion: '2.0.0' };
const env = { GITHUB_SHA: sha, GITHUB_REPOSITORY: 'CLX-Labs/cognition-curator', GH_TOKEN: 'test', GITHUB_EVENT_NAME: 'push' };
const pr = { merged_at: '2026-10-12', base: { ref: 'main' }, merge_commit_sha: sha, head: { ref: 'enhancement/release-policy' } };
const response = (prs) => async () => ({ ok: true, json: async () => prs });

function historyRun(records = []) {
  return async (...args) => {
    if (args[0] === 'tag') return records.map((r) => r.tag).join('\n');
    const record = records.find((r) => args.at(-1).includes(r.tag));
    if (args[0] === 'for-each-ref') return JSON.stringify(record);
    if (args[0] === 'rev-parse') return record.commit;
    if (args[0] === 'merge-base') return '';
    throw new Error(`Unexpected command: ${args}`);
  };
}

test('branch names select OTA/minor or native/major; ambiguous names do not silently release', () => {
  assert.equal(releaseType('enhancement/cards'), 'ota');
  assert.equal(releaseType('feature/widget'), 'native');
  for (const name of ['feat/cards', 'main', 'enhancement/', 'fix/bug', undefined])
    assert.throws(() => releaseType(name), /enhancement/);
});

test('minor updates preserve the native version, while major releases reset minor and patch', () => {
  const ota = planRelease(baseline, 'ota', sha);
  assert.equal(ota.version, '2.1.0');
  assert.equal(ota.nativeVersion, '2.0.0');
  const next = planRelease(ota, 'ota', oldSha);
  assert.equal(next.version, '2.2.0');
  const native = planRelease(next, 'native', sha);
  assert.equal(native.version, '3.0.0');
  assert.equal(native.nativeVersion, '3.0.0');
  assert.equal(planRelease(native, 'ota', oldSha).nativeVersion, '3.0.0');
  assert.throws(() => planRelease(baseline, 'auto', sha));
  assert.throws(() => planRelease({ ...baseline, version: '2.01.0' }, 'ota', sha));
});

test('lookup uses the exact merged commit and main target, independent of commit-message wording', () => {
  assert.equal(mergedBranch([pr, { ...pr, merge_commit_sha: oldSha }, { ...pr, merged_at: null }], sha), pr.head.ref);
  assert.throws(() => mergedBranch([{ ...pr, base: { ref: 'develop' } }], sha));
  assert.throws(() => mergedBranch([pr, pr], sha));
});

test('a new repository starts at 2.0.0 and resolves the source PR with a bounded retry', async () => {
  let calls = 0;
  const plan = await preparePolicy(env, { run: historyRun(), pause: async () => {}, fetcher: async () => {
    calls++;
    return { ok: true, json: async () => calls === 1 ? [] : [pr] };
  } });
  assert.equal(plan.version, '2.1.0');
  assert.equal(plan.kind, 'ota');
  assert.equal(plan.branch, pr.head.ref);
  assert.equal(calls, 2);
  assert.equal(plan.alreadyReleased, false);
});

test('failed releases have no tag and retries keep the same semantic version', async () => {
  const previous = planRelease(baseline, 'ota', oldSha);
  const opts = { run: historyRun([previous]), fetcher: response([pr]) };
  assert.equal((await preparePolicy(env, opts)).version, '2.2.0');
  assert.deepEqual(await preparePolicy(env, opts), await preparePolicy(env, opts));
});

test('successful reruns skip delivery, and superseded commits cannot roll the app back', async () => {
  const previous = planRelease(baseline, 'ota', oldSha);
  const current = planRelease(previous, 'native', sha);
  const opts = { run: historyRun([current, previous]), fetcher: async () => { throw new Error('Must not look up a delivered release'); } };
  assert.equal((await preparePolicy(env, opts)).alreadyReleased, true);
  await assert.rejects(preparePolicy({ ...env, GITHUB_SHA: oldSha }, opts), /superseded/);
});

test('direct pushes require an explicit manual type, and GitHub API failures block delivery', async () => {
  const manual = await preparePolicy({ ...env, GITHUB_EVENT_NAME: 'workflow_dispatch', REQUESTED_RELEASE_TYPE: 'native' }, { run: historyRun() });
  assert.equal(manual.version, '3.0.0');
  await assert.rejects(preparePolicy({ ...env, GITHUB_EVENT_NAME: 'workflow_dispatch' }, { run: historyRun() }), /release_type/);
  await assert.rejects(preparePolicy(env, { run: historyRun(), fetcher: async () => ({ ok: false, status: 403 }) }), /403/);
  await assert.rejects(preparePolicy(env, { run: historyRun(), fetcher: response([]), pause: async () => {} }), /merged PR/);
});

test('delivery history is an immutable annotated tag pointing to the released commit', async () => {
  const plan = planRelease(baseline, 'ota', sha);
  const calls = [];
  await recordRelease(plan, async (...args) => {
    calls.push(args);
    return '';
  });
  assert.deepEqual(calls.at(-1), ['push', 'origin', 'refs/tags/recollect/v2.1.0']);
  assert.ok(calls[1].includes(sha));
  assert.equal(JSON.parse(calls[1].at(-1)).nativeVersion, '2.0.0');
  await recordRelease(plan, historyRun([plan]));
  await assert.rejects(recordRelease({ ...plan, commit: oldSha }, historyRun([plan])), /different commit/);
});
