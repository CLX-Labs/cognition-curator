import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureApp, validateConfig } from './release-pipeline.mjs';

const exec = promisify(execFile);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fingerprintHash = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

async function runEas(args, options) {
  // JSON can contain signed artifact URLs. Capture CLI output rather than
  // streaming it to GitHub logs; only selected non-secret identifiers are logged.
  const { stdout } = await exec('eas', args, { ...options, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

function json(output, stage) {
  try { return JSON.parse(output); }
  catch { throw new Error(`EAS ${stage} returned invalid JSON; delivery was not confirmed.`); }
}

function storeBuild(build, { hash, nativeVersion, commit } = {}) {
  return build && uuid.test(build.id) && build.status === 'FINISHED' && build.platform === 'IOS'
    && build.distribution === 'STORE' && build.buildProfile === 'testflight'
    && build.updateChannel?.name === 'testflight' && build.isForIosSimulator === false
    && (!nativeVersion || build.appVersion === nativeVersion)
    && (!commit || build.gitCommitHash === commit)
    && (!hash || (build.fingerprint?.hash === hash && build.runtime?.version === hash));
}

export async function deliverRelease(env, {
  run = runEas,
  log = console.log,
  projectDir = fileURLToPath(new URL('../apps/mobile/', import.meta.url)),
} = {}) {
  validateConfig(env);
  let plan;
  try { plan = JSON.parse(env.RELEASE_PLAN_JSON); }
  catch { throw new Error('A valid RELEASE_PLAN_JSON is required for delivery.'); }
  if (!['native', 'ota'].includes(env.RELEASE_TYPE) || plan.kind !== env.RELEASE_TYPE
    || plan.commit !== env.GITHUB_SHA || plan.version !== env.RELEASE_VERSION
    || !version.test(plan.version ?? '') || !version.test(plan.nativeVersion ?? '')
    || (plan.kind === 'native' && plan.nativeVersion !== plan.version))
    throw new Error('Delivery must match the prepared release plan.');
  if (!/^r[1-9]\d*\.[1-9]\d*-[a-f0-9]{7}$/.test(env.RELEASE_ID ?? '')
    || !env.RELEASE_ID.endsWith(env.GITHUB_SHA.slice(0, 7)))
    throw new Error('RELEASE_ID must identify this stamped GitHub release.');
  const message = `${plan.version} · ${env.RELEASE_ID} · ${env.GITHUB_SHA}`;
  const command = async (stage, args) => {
    log(`EAS ${stage}: started.`);
    try { return await run(args, { cwd: projectDir, env }); }
    catch (error) {
      // Never include execFile's error/message/stdout/stderr: these may contain
      // credential values or signed URLs. EAS retains the detailed service logs.
      const code = Number.isInteger(error?.code) ? ` (exit ${error.code})` : '';
      throw new Error(`EAS ${stage} failed${code}. Check the project's EAS service dashboard; delivery was not confirmed.`);
    }
  };

  if (plan.kind === 'native') {
    const result = json(await command('build', ['build', '--platform', 'ios', '--profile', 'testflight',
      '--non-interactive', '--wait', '--json', '--message', message]), 'build');
    if (!Array.isArray(result) || result.length !== 1
      || !storeBuild(result[0], { nativeVersion: plan.nativeVersion, commit: plan.commit }))
      throw new Error('EAS did not confirm one completed TestFlight store build for this release.');
    const buildId = result[0].id;
    log(`EAS build: completed ${buildId}.`);
    if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `build_id=${buildId}\n`);
    if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY,
      `\nNative build completed: \`${buildId}\`. Submission is pending until this delivery step succeeds.\n`);
    const configFile = resolve(projectDir, 'eas.json');
    const original = await readFile(configFile, 'utf8');
    try {
      // eas.json is fingerprinted in full. Submission-only configuration must
      // be applied AFTER build upload and never in the OTA path.
      await configureApp(env.ASC_APP_ID, configFile);
      // CLI 24.12.1 has no --json flag for submit. Its waited exit status is the
      // confirmation; --id avoids accidentally selecting a newer team's build.
      await command('submission', ['submit', '--platform', 'ios', '--profile', 'testflight',
        '--id', buildId, '--non-interactive', '--wait']);
    } finally {
      await writeFile(configFile, original);
    }
    log(`EAS submission: completed for ${buildId}; Apple processing may still be pending.`);
    return { kind: 'native', buildId };
  }

  const fingerprint = json(await command('fingerprint', ['fingerprint:generate', '--platform', 'ios',
    '--build-profile', 'testflight', '--non-interactive', '--json']), 'fingerprint');
  const hash = fingerprint?.hash;
  if (!fingerprintHash.test(hash ?? '')) throw new Error('EAS did not return a valid iOS native fingerprint.');
  const builds = json(await command('compatible build lookup', ['build:list', '--platform', 'ios',
    '--status', 'finished', '--distribution', 'store', '--channel', 'testflight',
    '--build-profile', 'testflight', '--fingerprint-hash', hash, '--limit', '1',
    '--non-interactive', '--json']), 'compatible build lookup');
  if (!Array.isArray(builds) || builds.length !== 1
    || !storeBuild(builds[0], { hash, nativeVersion: plan.nativeVersion }))
    throw new Error('No completed compatible TestFlight runtime. Release native changes from feature/* before publishing an OTA.');
  log(`EAS OTA: compatible build ${builds[0].id}, runtime ${hash}.`);
  const updates = json(await command('update', ['update', '--platform', 'ios', '--channel', 'testflight',
    '--environment', 'preview', '--message', message, '--non-interactive', '--json']), 'update');
  if (!Array.isArray(updates) || updates.length !== 1 || !uuid.test(updates[0]?.group ?? '')
    || updates[0].platform?.toLowerCase() !== 'ios' || updates[0].runtimeVersion !== hash
    || updates[0].gitCommitHash !== plan.commit)
    throw new Error('EAS did not confirm an iOS OTA update for the expected runtime and commit.');
  log(`EAS update: published group ${updates[0].group}.`);
  return { kind: 'ota', groupId: updates[0].group, buildId: builds[0].id, fingerprint: hash };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await deliverRelease(process.env); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
