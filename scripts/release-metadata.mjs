import { readFile, writeFile, appendFile } from 'node:fs/promises';

export function createReleaseMetadata(env, now = new Date()) {
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) throw new Error('A full GITHUB_SHA is required.');
  for (const name of ['GITHUB_RUN_NUMBER', 'GITHUB_RUN_ATTEMPT', 'GITHUB_RUN_ID']) {
    if (!/^[1-9]\d*$/.test(env[name] ?? '')) throw new Error(`${name} must be a positive integer.`);
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '')) throw new Error('GITHUB_REPOSITORY is required.');
  return {
    id: `r${env.GITHUB_RUN_NUMBER}.${env.GITHUB_RUN_ATTEMPT}-${env.GITHUB_SHA.slice(0, 7)}`,
    commit: env.GITHUB_SHA,
    createdAt: now.toISOString(),
    runUrl: `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
  };
}

export async function prepareRelease(env, file = new URL('../apps/mobile/src/release-info.json', import.meta.url)) {
  const metadata = createReleaseMetadata(env);
  // A tracked JS-only file travels with both the embedded bundle and each OTA.
  // Reading the currently executing bundle never mistakes a download for an applied update.
  await readFile(file, 'utf8');
  await writeFile(file, JSON.stringify(metadata, null, 2) + '\n');
  if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `release_id=${metadata.id}\n`);
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY,
    `## App release ${metadata.id}\n\nCommit: \`${metadata.commit}\`\n\n` +
    'After a successful release, compare this label with **You → App version**. ' +
    'An OTA keeps the TestFlight build number; a native release increments it. ' +
    'This label identifies the source, not deployment success.\n');
  return metadata;
}
