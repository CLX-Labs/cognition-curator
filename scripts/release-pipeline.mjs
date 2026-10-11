import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

export function validateConfig(env) {
  for (const name of ['RAILWAY_TOKEN', 'EXPO_TOKEN', 'RAILWAY_PROJECT_ID',
    'RAILWAY_ENVIRONMENT_ID', 'RAILWAY_API_SERVICE_ID', 'RAILWAY_WORKER_SERVICE_ID',
    'STAGING_API_URL', 'GITHUB_SHA', 'ASC_APP_ID']) {
    if (!env[name]) throw new Error(`Configure ${name} in the GitHub staging environment.`);
  }
  if (env.RAILWAY_API_SERVICE_ID === env.RAILWAY_WORKER_SERVICE_ID)
    throw new Error('The API and worker must use separate Railway services.');
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA)) throw new Error('GITHUB_SHA must be a commit SHA.');
  if (!/^\d+$/.test(env.ASC_APP_ID)) throw new Error('ASC_APP_ID must be the numeric App Store Connect app ID.');
  const url = new URL(env.STAGING_API_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    url.pathname !== '/' || /(^localhost$|\.localhost$|\.trycloudflare\.com$|\.ngrok(-free)?\.(app|io)$)/i.test(url.hostname))
    throw new Error('STAGING_API_URL must be a stable HTTPS API origin, without credentials or a temporary tunnel.');
  return url.origin;
}

export async function configureApp(appId, configFile = new URL('../apps/mobile/eas.json', import.meta.url)) {
  if (!/^\d+$/.test(appId ?? '')) throw new Error('ASC_APP_ID must be the numeric App Store Connect app ID.');
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  config.submit.testflight.ios.ascAppId = appId;
  await writeFile(configFile, JSON.stringify(config, null, 2) + '\n');
}

function command(args, capture = false) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn('railway', args, { stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
    let output = '';
    child.stdout?.on('data', (chunk) => { output += chunk; });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolveCommand(output) :
      reject(new Error(`Railway ${args[0]} failed (${signal ?? code}).`)));
  });
}

export async function waitForDeployment(list, deploymentId, { attempts = 120, pause = () => sleep(10_000), log = console.log } = {}) {
  if (typeof deploymentId !== 'string' || !deploymentId) throw new Error('Railway upload did not return a deployment ID.');
  let lastStatus;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const deployments = await list();
    if (!Array.isArray(deployments)) throw new Error('Unexpected Railway deployment list response.');
    const deployment = deployments.find((d) => d.id === deploymentId);
    if (deployment) {
      if (deployment.status !== lastStatus) {
        lastStatus = deployment.status;
        log(`Deployment ${deploymentId}: ${lastStatus}`);
      }
      if (lastStatus === 'SUCCESS') return deploymentId;
      if (['FAILED', 'CRASHED', 'REMOVED', 'SKIPPED', 'CANCELED'].includes(lastStatus))
        throw new Error(`Deployment ${deploymentId} ended with ${lastStatus}. App release stopped.`);
    }
    if (attempt + 1 < attempts) await pause();
  }
  throw new Error('The requested Railway deployment did not become healthy. App release stopped.');
}

export async function checkHealth(origin, fetcher = fetch) {
  const response = await fetcher(`${origin}/health`, { signal: AbortSignal.timeout(15_000), cache: 'no-store' });
  if (!response.ok) throw new Error(`API health check failed (${response.status}).`);
  const body = await response.json();
  if (body.status !== 'ok' || body.service !== 'recollect-api')
    throw new Error('The staging URL does not serve the Recollect API.');
}

export async function deploy(env, run = command, options = {}) {
  const origin = validateConfig(env);
  for (const service of [env.RAILWAY_API_SERVICE_ID, env.RAILWAY_WORKER_SERVICE_ID]) {
    const target = ['--project', env.RAILWAY_PROJECT_ID, '--environment', env.RAILWAY_ENVIRONMENT_ID, '--service', service];
    const upload = JSON.parse(await run(['up', ...target, '--detach', '--json', '--message', env.GITHUB_SHA], true));
    await waitForDeployment(async () => JSON.parse(await run(['deployment', 'list', ...target, '--limit', '100', '--json'], true)), upload.deploymentId, options);
  }
  await checkHealth(origin, options.fetcher);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'validate') {
    validateConfig(process.env);
    console.log('Release configuration is present and uses a stable API origin.');
  } else if (process.argv[2] === 'deploy') await deploy(process.env);
  else if (process.argv[2] === 'configure-app') await configureApp(process.env.ASC_APP_ID);
  else throw new Error('Usage: node scripts/release-pipeline.mjs validate|deploy|configure-app');
}
