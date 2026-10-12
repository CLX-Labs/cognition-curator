import assert from 'node:assert/strict';
import test from 'node:test';
import { checkHealth, deploy, validateConfig, waitForDeployment } from './release-pipeline.mjs';

const env = { RAILWAY_TOKEN: 'test', EXPO_TOKEN: 'test', RAILWAY_PROJECT_ID: 'project',
  RAILWAY_ENVIRONMENT_ID: 'staging', RAILWAY_API_SERVICE_ID: 'api', RAILWAY_WORKER_SERVICE_ID: 'worker',
  API_URL: 'https://api.example.com', GITHUB_SHA: 'a'.repeat(40), ASC_APP_ID: '1234567890' };
const options = { attempts: 3, pause: async () => {}, log: () => {} };

test('rejects incomplete targets and temporary or credential-bearing API origins', () => {
  assert.throws(() => validateConfig({ ...env, RAILWAY_TOKEN: '' }), /RAILWAY_TOKEN/);
  assert.throws(() => validateConfig({ ...env, RAILWAY_WORKER_SERVICE_ID: 'api' }), /separate/);
  for (const url of ['http://api.example.com', 'https://test.trycloudflare.com', 'https://localhost',
    'https://user:password@api.example.com', 'https://api.example.com/api']) {
    assert.throws(() => validateConfig({ ...env, API_URL: url }), /stable HTTPS/);
  }
});

test('ignores unrelated successful deployments and pins the requested deployment', async () => {
  let calls = 0;
  const id = await waitForDeployment(async () => {
    calls++;
    return [{ id: 'other', status: 'SUCCESS', meta: { message: 'other' } },
      { id: 'ours', status: calls < 3 ? 'DEPLOYING' : 'SUCCESS' }];
  }, 'ours', options);
  assert.equal(id, 'ours');
  assert.equal(calls, 3);
});

test('missing and failed deployments stop the app release', async () => {
  await assert.rejects(waitForDeployment(async () => [{ id: 'old', status: 'SUCCESS' }], 'ours', options), /did not become healthy/);
  await assert.rejects(waitForDeployment(async () => [{ id: 'ours', status: 'FAILED', meta: { message: 'ours' } }], 'ours', options), /FAILED/);
});

test('an API deploy failure prevents the worker deploy and the health check', async () => {
  const uploads = [];
  await assert.rejects(deploy(env, async (args) => {
    if (args[0] === 'up') {
      uploads.push(args[args.indexOf('--service') + 1]);
      return JSON.stringify({ deploymentId: 'failed' });
    }
    return JSON.stringify([{ id: 'failed', status: 'CRASHED' }]);
  }, { ...options, fetcher: async () => { throw new Error('Must not check health'); } }), /CRASHED/);
  assert.deepEqual(uploads, ['api']);
});

test('both services must deploy before the Recollect health check', async () => {
  const uploads = [];
  await deploy(env, async (args) => {
    if (args[0] === 'up') {
      uploads.push(args[args.indexOf('--service') + 1]);
      return JSON.stringify({ deploymentId: `new-${uploads.length}` });
    }
    return JSON.stringify([{ id: `new-${uploads.length}`, status: 'SUCCESS' }]);
  }, { ...options, fetcher: async () => {
    assert.deepEqual(uploads, ['api', 'worker']);
    return { ok: true, json: async () => ({ status: 'ok', service: 'recollect-api' }) };
  } });
});

test('wrong-service or failed health responses block the app release', async () => {
  await assert.rejects(checkHealth('https://api.example.com', async () => ({ ok: false, status: 503 })), /503/);
  await assert.rejects(checkHealth('https://api.example.com', async () => ({ ok: true, json: async () => ({ status: 'ok', service: 'legacy' }) })), /Recollect/);
});
