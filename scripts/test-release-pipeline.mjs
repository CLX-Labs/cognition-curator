import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { validateConfig } from './release-pipeline.mjs';

const env = { EXPO_TOKEN: 'test', API_URL: 'https://api.example.com', GITHUB_SHA: 'a'.repeat(40), ASC_APP_ID: '1234567890' };

test('Expo releases require only app settings, with no Railway credentials or service IDs', () => {
  assert.equal(validateConfig(env), 'https://api.example.com');
  for (const name of Object.keys(env)) assert.throws(() => validateConfig({ ...env, [name]: '' }));
});

test('rejects temporary or credential-bearing API origins in the app configuration', () => {
  for (const url of ['http://api.example.com', 'https://test.trycloudflare.com', 'https://localhost',
    'https://user:password@api.example.com', 'https://api.example.com/api'])
    assert.throws(() => validateConfig({ ...env, API_URL: url }), /stable HTTPS/);
});

test('App Store submission settings are applied only after the native build, preserving OTA fingerprints', async () => {
  const github = parse(await readFile(new URL('../.github/workflows/recollect-release.yml', import.meta.url), 'utf8'));
  const expo = parse(await readFile(new URL('../apps/mobile/.eas/workflows/testflight-release.yml', import.meta.url), 'utf8'));
  const commands = github.jobs.release.steps.map(step => step.run ?? '').join('\n');
  assert.doesNotMatch(commands, /configure-app/, 'Do not mutate fingerprinted eas.json before uploading the app.');
  assert.match(commands, /--input asc_app_id="\$ASC_APP_ID"/);
  assert.equal(expo.on.workflow_dispatch.inputs.asc_app_id.required, true);
  const submission = expo.jobs.submit_testflight;
  assert.deepEqual(submission.needs, ['native_build']);
  assert.equal(submission.env.ASC_APP_ID, '${{ inputs.asc_app_id }}');
  assert.match(submission.hooks.after_checkout[0].run, /release-pipeline\.mjs configure-app/);
  for (const [name, job] of Object.entries(expo.jobs)) {
    if (name !== 'submit_testflight') assert.doesNotMatch(JSON.stringify(job), /configure-app/);
  }
});
