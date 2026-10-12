import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { prepareRelease } from './release-metadata.mjs';

export function validateConfig(env) {
  for (const name of ['EXPO_TOKEN', 'API_URL', 'GITHUB_SHA', 'ASC_APP_ID']) {
    if (!env[name]) throw new Error(`Configure ${name} in the GitHub main environment.`);
  }
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA)) throw new Error('GITHUB_SHA must be a commit SHA.');
  if (!/^\d+$/.test(env.ASC_APP_ID)) throw new Error('ASC_APP_ID must be the numeric App Store Connect app ID.');
  const url = new URL(env.API_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    url.pathname !== '/' || /(^localhost$|\.localhost$|\.trycloudflare\.com$|\.ngrok(-free)?\.(app|io)$)/i.test(url.hostname))
    throw new Error('API_URL must be a stable HTTPS API origin, without credentials or a temporary tunnel.');
  return url.origin;
}

export async function configureApp(appId, configFile = new URL('../apps/mobile/eas.json', import.meta.url)) {
  if (!/^\d+$/.test(appId ?? '')) throw new Error('ASC_APP_ID must be the numeric App Store Connect app ID.');
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  config.submit.testflight.ios.ascAppId = appId;
  await writeFile(configFile, JSON.stringify(config, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'validate') {
    validateConfig(process.env);
    console.log('Expo release configuration is present.');
  } else if (process.argv[2] === 'prepare-release') {
    const release = await prepareRelease(process.env);
    console.log(`App release: ${release.id}`);
  } else if (process.argv[2] === 'configure-app') await configureApp(process.env.ASC_APP_ID);
  else throw new Error('Usage: node scripts/release-pipeline.mjs validate|configure-app|prepare-release');
}
