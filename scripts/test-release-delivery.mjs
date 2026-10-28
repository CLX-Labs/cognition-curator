import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliverRelease } from './release-delivery.mjs';

const sha = 'a'.repeat(40);
const hash = 'b'.repeat(40);
const buildId = '00000000-0000-4000-8000-000000000001';
const groupId = '00000000-0000-4000-8000-000000000002';
const config =
  JSON.stringify(
    {
      build: { testflight: { channel: 'testflight' } },
      submit: { testflight: { ios: { appleTeamId: 'TESTTEAM' } } },
    },
    null,
    2,
  ) + '\n';
function environment(kind = 'native') {
  const plan = {
    kind,
    commit: sha,
    version: kind === 'native' ? '6.0.0' : '6.1.0',
    nativeVersion: '6.0.0',
  };
  return {
    EXPO_TOKEN: 'must-never-be-logged',
    API_URL: 'https://api.example.com',
    ASC_APP_ID: '6749138102',
    GITHUB_SHA: sha,
    RELEASE_ID: 'r50.1-aaaaaaa',
    RELEASE_TYPE: kind,
    RELEASE_VERSION: plan.version,
    RELEASE_PLAN_JSON: JSON.stringify(plan),
  };
}
function build(overrides = {}) {
  return {
    id: buildId,
    status: 'FINISHED',
    platform: 'IOS',
    distribution: 'STORE',
    buildProfile: 'testflight',
    updateChannel: { name: 'testflight' },
    isForIosSimulator: false,
    appVersion: '6.0.0',
    gitCommitHash: sha,
    fingerprint: { hash },
    runtime: { version: hash },
    artifacts: { applicationArchiveUrl: 'https://signed.example/private.ipa?secret=never-print' },
    ...overrides,
  };
}
const update = (overrides = {}) => [
  { group: groupId, platform: 'ios', runtimeVersion: hash, gitCommitHash: sha, ...overrides },
];

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'recollect-direct-delivery-'));
  await writeFile(join(dir, 'eas.json'), config);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const logs = [],
    calls = [];
  return {
    dir,
    logs,
    calls,
    options: { projectDir: dir, log: (line) => logs.push(line), readHistory: async () => [] },
  };
}

test('native delivery uploads unmodified configuration, submits its exact build, restores config, and logs no artifacts', async (t) => {
  const f = await fixture(t),
    env = {
      ...environment(),
      GITHUB_OUTPUT: join(f.dir, 'outputs'),
      GITHUB_STEP_SUMMARY: join(f.dir, 'summary'),
    };
  const result = await deliverRelease(env, {
    ...f.options,
    run: async (args, options) => {
      f.calls.push(args);
      assert.equal(options.cwd, f.dir);
      assert.equal(options.env, env);
      const current = await readFile(join(f.dir, 'eas.json'), 'utf8');
      if (args[0] === 'build') {
        assert.equal(
          current,
          config,
          'submission config must not change the uploaded native runtime',
        );
        assert.ok(
          args.includes('--wait') && args.includes('--json') && args.includes('--non-interactive'),
        );
        assert.ok(!args.includes('--auto-submit'));
        assert.equal(args.at(-1), '6.0.0 · r50.1-aaaaaaa · ' + sha);
        return JSON.stringify([build()]);
      }
      assert.equal(args[0], 'submit');
      assert.equal(JSON.parse(current).submit.testflight.ios.ascAppId, env.ASC_APP_ID);
      assert.deepEqual(args, [
        'submit',
        '--platform',
        'ios',
        '--profile',
        'testflight',
        '--id',
        buildId,
        '--non-interactive',
        '--wait',
      ]);
      return 'https://signed.example/secret must not be logged';
    },
  });
  assert.deepEqual(result, { kind: 'native', buildId });
  assert.deepEqual(
    f.calls.map((args) => args[0]),
    ['build', 'submit'],
  );
  assert.equal(await readFile(join(f.dir, 'eas.json'), 'utf8'), config);
  assert.equal(await readFile(env.GITHUB_OUTPUT, 'utf8'), `build_id=${buildId}\n`);
  assert.match(await readFile(env.GITHUB_STEP_SUMMARY, 'utf8'), /Submission is pending/);
  assert.doesNotMatch(f.logs.join('\n'), /signed\.example|never-print|must-never-be-logged/);
});

test('failed or ambiguous native builds never configure submission or submit', async (t) => {
  for (const response of [
    [build({ status: 'ERRORED' })],
    [],
    [build(), build()],
    [build({ gitCommitHash: 'c'.repeat(40) })],
  ]) {
    const f = await fixture(t);
    await assert.rejects(
      deliverRelease(environment(), {
        ...f.options,
        run: async (args) => {
          f.calls.push(args[0]);
          return JSON.stringify(response);
        },
      }),
      /one completed TestFlight/,
    );
    assert.deepEqual(f.calls, ['build']);
    assert.equal(await readFile(join(f.dir, 'eas.json'), 'utf8'), config);
  }
});

test('submission failures restore fingerprinted config and suppress credential-bearing CLI errors', async (t) => {
  const f = await fixture(t);
  const sensitive = 'must-never-be-logged https://signed.example/archive?token=secret';
  await assert.rejects(
    deliverRelease(environment(), {
      ...f.options,
      run: async (args) => {
        if (args[0] === 'build') return JSON.stringify([build()]);
        throw Object.assign(new Error(sensitive), {
          code: 1,
          stdout: sensitive,
          stderr: sensitive,
        });
      },
    }),
    (error) => {
      assert.match(error.message, /submission failed \(exit 1\)/);
      assert.ok(
        !error.message.includes('signed.example') &&
          !error.message.includes('must-never-be-logged'),
      );
      return true;
    },
  );
  assert.equal(await readFile(join(f.dir, 'eas.json'), 'utf8'), config);
  assert.doesNotMatch(
    f.logs.join('\n'),
    /submission: completed|signed\.example|must-never-be-logged/,
  );
});

test('OTA computes the preview profile runtime, checks an exact compatible build, and uses the same channel/environment', async (t) => {
  const f = await fixture(t);
  const result = await deliverRelease(environment('ota'), {
    ...f.options,
    run: async (args) => {
      f.calls.push(args);
      assert.equal(await readFile(join(f.dir, 'eas.json'), 'utf8'), config);
      if (args[0] === 'fingerprint:generate') return JSON.stringify({ hash });
      if (args[0] === 'build:list') return JSON.stringify([build()]);
      assert.equal(args[0], 'update');
      return JSON.stringify(update());
    },
  });
  assert.deepEqual(result, { kind: 'ota', groupId, buildId, fingerprint: hash });
  assert.deepEqual(f.calls[0], [
    'fingerprint:generate',
    '--platform',
    'ios',
    '--build-profile',
    'testflight',
    '--non-interactive',
    '--json',
  ]);
  assert.deepEqual(f.calls[1], [
    'build:list',
    '--platform',
    'ios',
    '--status',
    'finished',
    '--distribution',
    'store',
    '--channel',
    'testflight',
    '--build-profile',
    'testflight',
    '--fingerprint-hash',
    hash,
    '--limit',
    '1',
    '--non-interactive',
    '--json',
  ]);
  assert.ok(f.calls[2].includes('preview') && f.calls[2].includes('testflight'));
  assert.ok(!f.calls.some((args) => ['build', 'submit'].includes(args[0])));
  assert.doesNotMatch(f.logs.join('\n'), /signed\.example/);
});

test('OTA fails closed before publication for absent, incompatible, simulator, or incorrectly filtered store builds', async (t) => {
  for (const response of [
    [],
    [build({ fingerprint: { hash: 'c'.repeat(40) } })],
    [build({ runtime: { version: 'wrong' } })],
    [build({ appVersion: '5.0.0' })],
    [build({ updateChannel: { name: 'production' } })],
    [build({ buildProfile: 'preview' })],
    [build({ isForIosSimulator: true })],
  ]) {
    const f = await fixture(t);
    await assert.rejects(
      deliverRelease(environment('ota'), {
        ...f.options,
        run: async (args) => {
          f.calls.push(args[0]);
          return JSON.stringify(args[0] === 'fingerprint:generate' ? { hash } : response);
        },
      }),
      /No completed compatible TestFlight runtime/,
    );
    assert.deepEqual(f.calls, ['fingerprint:generate', 'build:list']);
    assert.equal(await readFile(join(f.dir, 'eas.json'), 'utf8'), config);
  }
});

test('an update is successful only with the expected iOS runtime and source commit', async (t) => {
  for (const response of [
    [],
    update({ runtimeVersion: 'wrong' }),
    update({ gitCommitHash: 'c'.repeat(40) }),
    update({ platform: 'android' }),
  ]) {
    const f = await fixture(t);
    await assert.rejects(
      deliverRelease(environment('ota'), {
        ...f.options,
        run: async (args) => {
          return JSON.stringify(
            args[0] === 'fingerprint:generate'
              ? { hash }
              : args[0] === 'build:list'
                ? [build()]
                : response,
          );
        },
      }),
      /did not confirm an iOS OTA/,
    );
    assert.doesNotMatch(f.logs.join('\n'), /update: published/);
  }
});

test('invalid plans and malformed fingerprints cannot start unintended delivery', async (t) => {
  const f = await fixture(t);
  const run = async () => {
    throw new Error('Should not run');
  };
  await assert.rejects(
    deliverRelease({ ...environment(), RELEASE_TYPE: 'auto' }, { ...f.options, run }),
    /prepared release plan/,
  );
  await assert.rejects(
    deliverRelease({ ...environment(), RELEASE_ID: 'r50.1-bbbbbbb' }, { ...f.options, run }),
    /RELEASE_ID/,
  );
  await assert.rejects(
    deliverRelease(environment('ota'), {
      ...f.options,
      run: async () => JSON.stringify({ hash: 'not-a-hash' }),
    }),
    /valid iOS native fingerprint/,
  );
  await assert.rejects(
    deliverRelease(environment(), {
      ...f.options,
      run: async () => 'not JSON https://signed.example/secret',
    }),
    /invalid JSON/,
  );
});

async function localFixture(t) {
  const f = await fixture(t);
  const env = {
    ...environment(),
    LOCAL_NATIVE_BUILD: 'true',
    RUNNER_TEMP: f.dir,
    RELEASE_PLAN_FILE: join(f.dir, 'plan.json'),
  };
  await writeFile(env.RELEASE_PLAN_FILE, env.RELEASE_PLAN_JSON);
  return { ...f, env };
}

test('local native delivery verifies and uploads the exact IPA before recording durable runtime proof', async (t) => {
  const f = await localFixture(t);
  let verified = false;
  const result = await deliverRelease(f.env, {
    ...f.options,
    verifyArchive: async (path, expected) => {
      assert.equal(path, join(f.dir, 'recollect-release.ipa'));
      assert.deepEqual(expected, { nativeVersion: '6.0.0', runtimeVersion: hash });
      assert.equal(await readFile(join(f.dir, 'eas.json'), 'utf8'), config);
      verified = true;
      return { archiveSha256: 'c'.repeat(64), buildNumber: '8' };
    },
    run: async (args) => {
      f.calls.push(args);
      if (args[0] === 'fingerprint:generate') return JSON.stringify({ hash });
      if (args[0] === 'build') {
        assert.ok(
          args.includes('--local') && !args.includes('--json') && !args.includes('--auto-submit'),
        );
        assert.equal(await readFile(f.env.RELEASE_PLAN_FILE, 'utf8'), f.env.RELEASE_PLAN_JSON);
        return 'local build completed';
      }
      assert.ok(verified);
      assert.deepEqual(args, [
        'submit',
        '--platform',
        'ios',
        '--profile',
        'testflight',
        '--path',
        join(f.dir, 'recollect-release.ipa'),
        '--non-interactive',
        '--wait',
      ]);
      assert.equal(
        JSON.parse(await readFile(join(f.dir, 'eas.json'), 'utf8')).submit.testflight.ios.ascAppId,
        f.env.ASC_APP_ID,
      );
      assert.equal(await readFile(f.env.RELEASE_PLAN_FILE, 'utf8'), f.env.RELEASE_PLAN_JSON);
      return 'signed artifact URL must stay private';
    },
  });
  assert.equal(result.localRuntime.delivery, 'local-ios-store-upload');
  assert.equal(result.localRuntime.runtimeVersion, hash);
  assert.equal(result.localRuntime.commit, sha);
  assert.equal(result.localRuntime.buildNumber, '8');
  assert.deepEqual(
    JSON.parse(await readFile(f.env.RELEASE_PLAN_FILE, 'utf8')).localRuntime,
    result.localRuntime,
  );
  assert.equal(await readFile(join(f.dir, 'eas.json'), 'utf8'), config);
  assert.doesNotMatch(f.logs.join('\n'), /artifact URL|must-never-be-logged/);
});

test('failed local verification or upload cannot create release proof and always restores submission config', async (t) => {
  for (const failure of ['verify', 'submit']) {
    const f = await localFixture(t);
    await assert.rejects(
      deliverRelease(f.env, {
        ...f.options,
        verifyArchive: async () => {
          if (failure === 'verify') throw new Error('sensitive signing details');
          return { archiveSha256: 'c'.repeat(64), buildNumber: '8' };
        },
        run: async (args) => {
          f.calls.push(args[0]);
          if (args[0] === 'fingerprint:generate') return JSON.stringify({ hash });
          if (args[0] === 'submit')
            throw Object.assign(new Error('sensitive upload details'), { code: 1 });
          return '';
        },
      }),
      failure === 'verify' ? /verification failed/ : /submission failed/,
    );
    assert.equal(f.calls.includes('submit'), failure === 'submit');
    assert.equal(await readFile(f.env.RELEASE_PLAN_FILE, 'utf8'), f.env.RELEASE_PLAN_JSON);
    assert.equal(await readFile(join(f.dir, 'eas.json'), 'utf8'), config);
    assert.doesNotMatch(f.logs.join('\n'), /completed|sensitive/);
  }
});

test('OTA accepts matching successful local native proof, but rejects changed identity, runtime, or latest native release', async (t) => {
  const f = await localFixture(t);
  const delivered = await deliverRelease(f.env, {
    ...f.options,
    verifyArchive: async () => ({ archiveSha256: 'c'.repeat(64), buildNumber: '8' }),
    run: async (args) => (args[0] === 'fingerprint:generate' ? JSON.stringify({ hash }) : ''),
  });
  const native = { ...JSON.parse(f.env.RELEASE_PLAN_JSON), localRuntime: delivered.localRuntime };
  const run = async (args) => {
    f.calls.push(args[0]);
    return JSON.stringify(
      args[0] === 'fingerprint:generate' ? { hash } : args[0] === 'build:list' ? [] : update(),
    );
  };
  const result = await deliverRelease(environment('ota'), {
    ...f.options,
    run,
    readHistory: async () => [native],
  });
  assert.equal(result.localRuntime, delivered.localRuntime);
  assert.equal(result.groupId, groupId);
  assert.equal(result.buildId, undefined);
  for (const bad of [
    { ...native, localRuntime: { ...native.localRuntime, channel: 'production' } },
    { ...native, localRuntime: { ...native.localRuntime, runtimeVersion: 'd'.repeat(40) } },
    { ...native, localRuntime: { ...native.localRuntime, commit: 'e'.repeat(40) } },
    { ...native, nativeVersion: '7.0.0', version: '7.0.0' },
  ]) {
    f.calls.length = 0;
    await assert.rejects(
      deliverRelease(environment('ota'), {
        ...f.options,
        run,
        readHistory: async () => [bad, native],
      }),
      /No completed compatible/,
    );
    assert.deepEqual(f.calls, ['fingerprint:generate', 'build:list']);
  }
});
