import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { configureApp, validateConfig } from './release-pipeline.mjs';
import { readReleaseHistory } from './release-policy.mjs';
import { iosIdentity, validLocalRuntimeProof, verifyIosArchive } from './local-ios-release.mjs';

const exec = promisify(execFile);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fingerprintHash = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function localBuildDiagnostics(error, env) {
  const chunks = [],
    seen = new Set();
  const collect = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 3 || seen.size >= 16)
      return;
    seen.add(value);
    for (const key of ['stdout', 'stderr']) {
      if (typeof value[key] === 'string' || Buffer.isBuffer(value[key]))
        chunks.push(String(value[key]));
    }
    collect(value.cause, depth + 1);
    if (Array.isArray(value.errors)) for (const nested of value.errors) collect(nested, depth + 1);
  };
  collect(error);
  const secrets = Object.entries(env)
    .filter(
      ([key, value]) =>
        /token|secret|password|private|credential|webhook|api.?key|dsn|database.?url|authorization/i.test(
          key,
        ) &&
        typeof value === 'string' &&
        value.length >= 4,
    )
    .map(([, value]) => value)
    .sort((a, b) => b.length - a.length);
  const result = [],
    unique = new Set();
  for (const chunk of chunks) {
    // Inspect a bounded tail, where build tools normally summarize failures.
    // No raw child output is persisted or forwarded to GitHub.
    let safe = chunk
      .slice(-2 * 1024 * 1024)
      .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, '')
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\r/g, '\n')
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
    for (const secret of secrets) safe = safe.split(secret).join('[redacted]');
    let pem = false;
    for (const raw of safe.split('\n')) {
      if (/-----BEGIN [A-Z0-9 ]+-----/.test(raw)) pem = true;
      if (pem) {
        if (/-----END [A-Z0-9 ]+-----/.test(raw)) pem = false;
        continue;
      }
      if (!/\berror\b|\bfatal\b|\bfailed\b|❌|\[!\]|ERR_[A-Z_]+/i.test(raw)) continue;
      const text = raw.replace(/\b(?:https?|ftp):\/\/[^\s]+/gi, '[URL redacted]').trim();
      // Unknown managed signing material is not necessarily in the process
      // environment. Drop credential-bearing lines rather than guessing at it.
      if (
        /authorization|bearer\s|cookies?|session[ _-]?(?:id|token|secret)|password|private[ _-]?key|api[ _-]?key|access[ _-]?token|credentials?|certificate|provisioning|signing|keystore|\.p(?:8|12)\b|["']?(?:key|token|secret)["']?\s*[:=]/i.test(
          text,
        )
      )
        continue;
      if (!text) continue;
      // Prefixing every line prevents untrusted tool output from becoming a
      // GitHub workflow command (for example ::error:: or ::add-mask::).
      const line = `[native build diagnostic] ${text}`.slice(0, 300);
      if (!unique.has(line)) {
        result.push(line);
        unique.add(line);
      }
    }
  }
  return result.slice(-50);
}

async function runEas(args, options) {
  // JSON can contain signed artifact URLs. Capture CLI output rather than
  // streaming it to GitHub logs; only selected non-secret identifiers are logged.
  const { stdout } = await exec('eas', args, { ...options, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

function json(output, stage) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`EAS ${stage} returned invalid JSON; delivery was not confirmed.`);
  }
}

function storeBuild(build, { hash, nativeVersion, commit } = {}) {
  return (
    build &&
    uuid.test(build.id) &&
    build.status === 'FINISHED' &&
    build.platform === 'IOS' &&
    build.distribution === 'STORE' &&
    build.buildProfile === 'testflight' &&
    build.updateChannel?.name === 'testflight' &&
    build.isForIosSimulator === false &&
    (!nativeVersion || build.appVersion === nativeVersion) &&
    (!commit || build.gitCommitHash === commit) &&
    (!hash || (build.fingerprint?.hash === hash && build.runtime?.version === hash))
  );
}

export async function deliverRelease(
  env,
  {
    run = runEas,
    log = console.log,
    projectDir = fileURLToPath(new URL('../apps/mobile/', import.meta.url)),
    verifyArchive = verifyIosArchive,
    readHistory = readReleaseHistory,
  } = {},
) {
  validateConfig(env);
  let plan;
  try {
    plan = JSON.parse(env.RELEASE_PLAN_JSON);
  } catch {
    throw new Error('A valid RELEASE_PLAN_JSON is required for delivery.');
  }
  if (
    !['native', 'ota'].includes(env.RELEASE_TYPE) ||
    plan.kind !== env.RELEASE_TYPE ||
    plan.commit !== env.GITHUB_SHA ||
    plan.version !== env.RELEASE_VERSION ||
    !version.test(plan.version ?? '') ||
    !version.test(plan.nativeVersion ?? '') ||
    (plan.kind === 'native' && plan.nativeVersion !== plan.version)
  )
    throw new Error('Delivery must match the prepared release plan.');
  if (
    !/^r[1-9]\d*\.[1-9]\d*-[a-f0-9]{7}$/.test(env.RELEASE_ID ?? '') ||
    !env.RELEASE_ID.endsWith(env.GITHUB_SHA.slice(0, 7))
  )
    throw new Error('RELEASE_ID must identify this stamped GitHub release.');
  const message = `${plan.version} · ${env.RELEASE_ID} · ${env.GITHUB_SHA}`;
  const command = async (stage, args) => {
    log(`EAS ${stage}: started.`);
    try {
      return await run(args, { cwd: projectDir, env });
    } catch (error) {
      // Only local compilation needs console diagnostics: there is no cloud
      // build log. Never print raw execFile output, even for a failed build.
      if (stage === 'local build') for (const line of localBuildDiagnostics(error, env)) log(line);
      const code = Number.isInteger(error?.code) ? ` (exit ${error.code})` : '';
      const location =
        stage === 'local build'
          ? 'The native build failed on this GitHub macOS runner; no cloud build was created.'
          : "Check the project's EAS service dashboard.";
      throw new Error(`EAS ${stage} failed${code}. ${location} Delivery was not confirmed.`);
    }
  };

  if (plan.kind === 'native' && env.LOCAL_NATIVE_BUILD === 'true') {
    const fingerprint = json(
      await command('fingerprint', [
        'fingerprint:generate',
        '--platform',
        'ios',
        '--build-profile',
        'testflight',
        '--non-interactive',
        '--json',
      ]),
      'fingerprint',
    );
    const hash = fingerprint?.hash;
    if (!fingerprintHash.test(hash ?? ''))
      throw new Error('EAS did not return a valid iOS native fingerprint.');
    if (!env.RELEASE_PLAN_FILE)
      throw new Error('Local native delivery requires a release plan file.');
    const archive = resolve(env.RUNNER_TEMP || tmpdir(), 'recollect-release.ipa');
    await rm(archive, { force: true });
    await command('local build', [
      'build',
      '--platform',
      'ios',
      '--profile',
      'testflight',
      '--local',
      '--non-interactive',
      '--output',
      archive,
      '--message',
      message,
    ]);
    let verified;
    try {
      verified = await verifyArchive(archive, {
        nativeVersion: plan.nativeVersion,
        runtimeVersion: hash,
      });
    } catch {
      throw new Error('Local signed iOS artifact verification failed; submission was not started.');
    }
    const configFile = resolve(projectDir, 'eas.json');
    const original = await readFile(configFile, 'utf8');
    try {
      await configureApp(env.ASC_APP_ID, configFile);
      await command('submission', [
        'submit',
        '--platform',
        'ios',
        '--profile',
        'testflight',
        '--path',
        archive,
        '--non-interactive',
        '--wait',
      ]);
    } finally {
      await writeFile(configFile, original);
    }
    const proof = {
      schema: 1,
      delivery: 'local-ios-store-upload',
      ...iosIdentity,
      nativeVersion: plan.nativeVersion,
      runtimeVersion: hash,
      commit: plan.commit,
      ...verified,
      uploadedAt: new Date().toISOString(),
    };
    if (!validLocalRuntimeProof(proof, plan))
      throw new Error('Local native delivery proof is invalid; release was not recorded.');
    // This file is consumed by recordRelease only after a successful waited
    // submission. Its annotated tag is the durable proof for later OTA checks.
    await writeFile(
      env.RELEASE_PLAN_FILE,
      JSON.stringify({ ...plan, localRuntime: proof }, null, 2) + '\n',
    );
    if (env.GITHUB_STEP_SUMMARY)
      await appendFile(
        env.GITHUB_STEP_SUMMARY,
        `\nVerified local iOS ${plan.nativeVersion} (${proof.buildNumber}), runtime \`${hash}\`, SHA-256 \`${proof.archiveSha256}\`, uploaded to App Store Connect. Apple processing may still be pending.\n`,
      );
    log(
      `EAS local submission: completed ${plan.nativeVersion} (${proof.buildNumber}); Apple processing may still be pending.`,
    );
    return { kind: 'native', localRuntime: proof };
  }

  if (plan.kind === 'native') {
    const result = json(
      await command('build', [
        'build',
        '--platform',
        'ios',
        '--profile',
        'testflight',
        '--non-interactive',
        '--wait',
        '--json',
        '--message',
        message,
      ]),
      'build',
    );
    if (
      !Array.isArray(result) ||
      result.length !== 1 ||
      !storeBuild(result[0], { nativeVersion: plan.nativeVersion, commit: plan.commit })
    )
      throw new Error('EAS did not confirm one completed TestFlight store build for this release.');
    const buildId = result[0].id;
    log(`EAS build: completed ${buildId}.`);
    if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `build_id=${buildId}\n`);
    if (env.GITHUB_STEP_SUMMARY)
      await appendFile(
        env.GITHUB_STEP_SUMMARY,
        `\nNative build completed: \`${buildId}\`. Submission is pending until this delivery step succeeds.\n`,
      );
    const configFile = resolve(projectDir, 'eas.json');
    const original = await readFile(configFile, 'utf8');
    try {
      // eas.json is fingerprinted in full. Submission-only configuration must
      // be applied AFTER build upload and never in the OTA path.
      await configureApp(env.ASC_APP_ID, configFile);
      // CLI 24.12.1 has no --json flag for submit. Its waited exit status is the
      // confirmation; --id avoids accidentally selecting a newer team's build.
      await command('submission', [
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
    } finally {
      await writeFile(configFile, original);
    }
    log(`EAS submission: completed for ${buildId}; Apple processing may still be pending.`);
    return { kind: 'native', buildId };
  }

  const fingerprint = json(
    await command('fingerprint', [
      'fingerprint:generate',
      '--platform',
      'ios',
      '--build-profile',
      'testflight',
      '--non-interactive',
      '--json',
    ]),
    'fingerprint',
  );
  const hash = fingerprint?.hash;
  if (!fingerprintHash.test(hash ?? ''))
    throw new Error('EAS did not return a valid iOS native fingerprint.');
  const builds = json(
    await command('compatible build lookup', [
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
    ]),
    'compatible build lookup',
  );
  if (!Array.isArray(builds))
    throw new Error('EAS compatible build lookup returned invalid JSON data.');
  const compatible =
    builds.length === 1 && storeBuild(builds[0], { hash, nativeVersion: plan.nativeVersion });
  let localRuntime;
  if (!compatible && builds.length === 0) {
    // readReleaseHistory verifies each immutable annotated tag points to its
    // recorded commit. Use only the latest native release, never arbitrary proof.
    const native = (await readHistory()).find((record) => record.kind === 'native');
    if (
      native &&
      validLocalRuntimeProof(native.localRuntime, native, {
        hash,
        nativeVersion: plan.nativeVersion,
      })
    )
      localRuntime = native.localRuntime;
  }
  if (!compatible && !localRuntime)
    throw new Error(
      'No completed compatible TestFlight runtime. Release native changes from feature/* before publishing an OTA.',
    );
  log(
    `EAS OTA: compatible ${compatible ? 'build ' + builds[0].id : 'verified local native ' + localRuntime.nativeVersion}, runtime ${hash}.`,
  );
  const updates = json(
    await command('update', [
      'update',
      '--platform',
      'ios',
      '--channel',
      'testflight',
      '--environment',
      'preview',
      '--message',
      message,
      '--non-interactive',
      '--json',
    ]),
    'update',
  );
  if (
    !Array.isArray(updates) ||
    updates.length !== 1 ||
    !uuid.test(updates[0]?.group ?? '') ||
    updates[0].platform?.toLowerCase() !== 'ios' ||
    updates[0].runtimeVersion !== hash ||
    updates[0].gitCommitHash !== plan.commit
  )
    throw new Error('EAS did not confirm an iOS OTA update for the expected runtime and commit.');
  log(`EAS update: published group ${updates[0].group}.`);
  return {
    kind: 'ota',
    groupId: updates[0].group,
    ...(compatible ? { buildId: builds[0].id } : { localRuntime }),
    fingerprint: hash,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await deliverRelease(process.env);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
