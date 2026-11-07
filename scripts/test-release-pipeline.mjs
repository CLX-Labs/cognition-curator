import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { validateConfig } from './release-pipeline.mjs';

const env = {
  EXPO_TOKEN: 'test',
  API_URL: 'https://api.example.com',
  GITHUB_SHA: 'a'.repeat(40),
  ASC_APP_ID: '1234567890',
};

test('Expo releases require only app settings, with no Railway credentials or service IDs', () => {
  assert.equal(validateConfig(env), 'https://api.example.com');
  for (const name of Object.keys(env)) assert.throws(() => validateConfig({ ...env, [name]: '' }));
});

test('rejects temporary or credential-bearing API origins in the app configuration', () => {
  for (const url of [
    'http://api.example.com',
    'https://test.trycloudflare.com',
    'https://localhost',
    'https://user:password@api.example.com',
    'https://api.example.com/api',
  ])
    assert.throws(() => validateConfig({ ...env, API_URL: url }), /stable HTTPS/);
});

test('main pushes always run checks while app planning, delivery and reporting require mobile changes', async () => {
  const github = parse(
    await readFile(new URL('../.github/workflows/recollect-release.yml', import.meta.url), 'utf8'),
  );
  assert.deepEqual(github.on.push, { branches: ['main'] });
  assert.equal(github.on.workflow_dispatch.inputs.release_type.required, true);
  const scope = github.jobs.scope;
  assert.equal(scope.if, "github.ref == 'refs/heads/main'");
  assert.equal(scope.outputs.release_required, '${{ steps.scope.outputs.release_required }}');
  assert.equal(scope.steps.find((step) => step.uses === 'actions/checkout@v4').with['fetch-depth'], 0);
  const scopeStep = scope.steps.find((step) => step.id === 'scope');
  assert.equal(scopeStep.run, 'node scripts/mobile-release-scope.mjs');
  assert.equal(scopeStep.env.GITHUB_EVENT_BEFORE, '${{ github.event.before }}');
  assert.equal(scope.environment, undefined, 'Scope checks must not unlock app delivery credentials.');
  assert.equal(github.jobs.checks.if, undefined, 'Backend-only main pushes still run CI checks.');
  assert.equal(github.jobs.checks.needs, undefined, 'A scope-check failure must not hide test results.');
  for (const name of ['plan', 'release', 'report']) {
    assert.ok(github.jobs[name].needs.includes('scope'), `${name} must depend on the scope result`);
    assert.match(github.jobs[name].if, /needs\.scope\.outputs\.release_required == 'true'/u,
      `${name} must compare the string output explicitly; 'false' is a nonempty string`);
  }
  assert.match(github.jobs.report.if, /^always\(\)/u, 'Actual mobile release failures still need a report.');
  assert.ok(github.jobs.release.needs.includes('checks'));
  assert.ok(github.jobs.release.needs.includes('plan'));
  const checks = parse(await readFile(new URL('../.github/workflows/recollect-ci.yml', import.meta.url), 'utf8'));
  assert.ok(checks.jobs['types-and-tests'].steps.some((step) =>
    step.run === 'node --test scripts/test-mobile-release-scope.mjs'));
});

test('GitHub delivers through direct EAS commands and records a version only after delivery succeeds', async () => {
  const github = parse(
    await readFile(new URL('../.github/workflows/recollect-release.yml', import.meta.url), 'utf8'),
  );
  const steps = github.jobs.release.steps;
  const commands = steps.map((step) => step.run ?? '').join('\n');
  assert.doesNotMatch(
    commands,
    /configure-app/,
    'Do not mutate fingerprinted eas.json before uploading the app.',
  );
  assert.doesNotMatch(
    commands,
    /workflow:run/,
    'Normal releases must not consume EAS Workflows CI minutes.',
  );
  const delivery = steps.find((step) => step.id === 'delivery');
  assert.equal(delivery.run, 'node scripts/release-delivery.mjs');
  assert.equal(delivery.env.RELEASE_ID, '${{ steps.metadata.outputs.release_id }}');
  assert.ok(
    steps.indexOf(delivery) <
      steps.findIndex((step) => step.run === 'node scripts/release-policy.mjs record'),
  );
  assert.equal(github.jobs.release.env.EXPO_TOKEN, '${{ secrets.EXPO_TOKEN }}');
  assert.equal(github.jobs.release.env.ASC_APP_ID, '${{ vars.ASC_APP_ID }}');
  assert.equal(
    github.jobs.release['runs-on'],
    "${{ needs.plan.outputs.release_type == 'native' && 'macos-26' || 'ubuntu-latest' }}",
  );
  assert.equal(github.jobs.release.env.LOCAL_NATIVE_BUILD, 'true');
});

test('the optional legacy submission workflow still targets an exact existing build', async () => {
  const expo = parse(
    await readFile(
      new URL('../apps/mobile/.eas/workflows/submit-existing.yml', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(expo.on.workflow_dispatch.inputs.build_id.required, true);
  assert.equal(expo.on.workflow_dispatch.inputs.asc_app_id.required, true);
  assert.deepEqual(Object.keys(expo.jobs), ['submit_testflight']);
  const submission = expo.jobs.submit_testflight;
  assert.equal(submission.type, 'submit');
  assert.equal(submission.params.build_id, '${{ inputs.build_id }}');
  assert.equal(submission.params.profile, 'testflight');
  assert.equal(submission.env.ASC_APP_ID, '${{ inputs.asc_app_id }}');
  assert.match(submission.hooks.after_checkout[0].run, /release-pipeline\.mjs configure-app/);
});
