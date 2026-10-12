import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const exec = promisify(execFile);
const git = async (...args) => (await exec('git', args)).stdout.trim();
const prefix = 'recollect/v';
const baseline = { version: '2.0.0', nativeVersion: '2.0.0' };

function parts(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? ''))
    throw new Error(`Invalid release version: ${version}`);
  const numbers = version.split('.').map(Number);
  if (!numbers.every(Number.isSafeInteger)) throw new Error('Release version is too large.');
  return numbers;
}

export function releaseType(branch) {
  if (/^enhancement\/.+/.test(branch ?? '')) return 'ota';
  if (/^feature\/.+/.test(branch ?? '')) return 'native';
  throw new Error('Merge from enhancement/* (OTA/minor) or feature/* (native/major). For a direct push, manually dispatch with an explicit release_type.');
}

export function mergedBranch(prs, sha) {
  const matches = prs.filter((pr) => pr.merged_at && pr.base?.ref === 'main' && pr.merge_commit_sha === sha);
  if (matches.length !== 1) throw new Error('Could not identify one merged PR for this main commit. Manually dispatch with an explicit release_type.');
  return matches[0].head.ref;
}

export function planRelease(previous, kind, commit, branch = null) {
  if (!['ota', 'native'].includes(kind)) throw new Error('release_type must be ota or native.');
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('A full commit SHA is required.');
  const [major, minor] = parts(previous.version);
  parts(previous.nativeVersion);
  const version = kind === 'native' ? `${major + 1}.0.0` : `${major}.${minor + 1}.0`;
  parts(version);
  return { version, nativeVersion: kind === 'native' ? version : previous.nativeVersion,
    kind, commit, branch, tag: `${prefix}${version}` };
}

export async function readReleaseHistory(run = git) {
  const tags = (await run('tag', '--list', `${prefix}*`, '--sort=-version:refname')).split('\n').filter(Boolean);
  const records = [];
  for (const tag of tags) {
    const record = JSON.parse(await run('for-each-ref', '--format=%(contents)', `refs/tags/${tag}`));
    parts(record.version);
    parts(record.nativeVersion);
    if (tag !== `${prefix}${record.version}` || record.tag !== tag || !['ota', 'native'].includes(record.kind) ||
      !/^[a-f0-9]{40}$/.test(record.commit ?? '') || await run('rev-parse', `${tag}^{commit}`) !== record.commit)
      throw new Error(`Invalid release record: ${tag}`);
    records.push(record);
  }
  return records;
}

export async function preparePolicy(env, { run = git, fetcher = fetch, pause = () => sleep(2_000) } = {}) {
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) throw new Error('A full GITHUB_SHA is required.');
  const records = await readReleaseHistory(run);
  const latest = records[0];
  const existing = records.find((record) => record.commit === env.GITHUB_SHA);
  // Never redeploy an old successful release over a newer release.
  if (existing && existing !== latest) throw new Error('This commit was superseded by a newer release.');
  if (existing) return { ...existing, alreadyReleased: true };
  if (latest) await run('merge-base', '--is-ancestor', latest.commit, env.GITHUB_SHA);
  let branch = null;
  let kind;
  if (env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    kind = env.REQUESTED_RELEASE_TYPE;
  } else {
    if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '') || !env.GH_TOKEN)
      throw new Error('GitHub repository and token are required to resolve the merged branch.');
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetcher(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/commits/${env.GITHUB_SHA}/pulls?per_page=100`, {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.GH_TOKEN}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Merged PR lookup failed (${response.status}).`);
      const prs = await response.json();
      try { branch = mergedBranch(prs, env.GITHUB_SHA); break; }
      catch (error) { if (attempt === 2) throw error; await pause(); }
    }
    kind = releaseType(branch);
  }
  return { ...planRelease(latest ?? baseline, kind, env.GITHUB_SHA, branch), alreadyReleased: false };
}

export async function recordRelease(plan, run = git) {
  const existing = (await readReleaseHistory(run)).find((record) => record.tag === plan.tag);
  if (existing) {
    if (existing.commit !== plan.commit) throw new Error('Release tag already belongs to a different commit.');
    return;
  }
  await run('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    'tag', '-a', plan.tag, plan.commit, '-m', JSON.stringify(plan));
  await run('push', 'origin', `refs/tags/${plan.tag}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const planFile = process.env.RELEASE_PLAN_FILE;
  if (!planFile) throw new Error('RELEASE_PLAN_FILE is required.');
  if (process.argv[2] === 'prepare') {
    const plan = await preparePolicy(process.env);
    await writeFile(planFile, JSON.stringify(plan, null, 2) + '\n');
    await writeFile(new URL('../apps/mobile/native-version.json', import.meta.url), JSON.stringify({ version: plan.nativeVersion }, null, 2) + '\n');
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
      `release_type=${plan.kind}\nrelease_version=${plan.version}\nnative_version=${plan.nativeVersion}\nalready_released=${plan.alreadyReleased}\nplan=${JSON.stringify(plan)}\n`);
    console.log(`${plan.version}: ${plan.kind}, native ${plan.nativeVersion}${plan.alreadyReleased ? ' (already released)' : ''}`);
  } else if (process.argv[2] === 'hydrate') {
    const plan = JSON.parse(process.env.RELEASE_PLAN_JSON);
    parts(plan.version);
    parts(plan.nativeVersion);
    if (plan.commit !== process.env.GITHUB_SHA) throw new Error('Release plan must match the checked-out commit.');
    await writeFile(planFile, JSON.stringify(plan, null, 2) + '\n');
    await writeFile(new URL('../apps/mobile/native-version.json', import.meta.url), JSON.stringify({ version: plan.nativeVersion }, null, 2) + '\n');
  } else if (process.argv[2] === 'record') {
    await recordRelease(JSON.parse(await readFile(planFile, 'utf8')));
  } else throw new Error('Usage: node scripts/release-policy.mjs prepare|hydrate|record');
}
