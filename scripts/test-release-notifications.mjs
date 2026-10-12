import assert from 'node:assert/strict';
import test from 'node:test';
import { releaseReport, notifySlack, reportRelease } from './release-notifications.mjs';

const env = { GITHUB_REPOSITORY: 'CLX-Labs/cognition-curator', GITHUB_RUN_ID: '123', GITHUB_SHA: 'a'.repeat(40),
  RELEASE_VERSION: '2.1.0', RELEASE_TYPE: 'ota', CHECKS_RESULT: 'success', PLAN_RESULT: 'success' };
const webhook = 'https://hooks.slack.com/services/test/workspace/secret';

test('only confirmed deliveries are announced as published or submitted', () => {
  assert.match(releaseReport({ ...env, RELEASE_RESULT: 'success' }).title, /OTA published/);
  assert.match(releaseReport({ ...env, RELEASE_TYPE: 'native', RELEASE_RESULT: 'success' }).title, /submitted to TestFlight/);
  assert.match(releaseReport({ ...env, RELEASE_RESULT: 'failure' }).title, /Release failed/);
  assert.match(releaseReport({ ...env, RELEASE_RESULT: 'failure', DELIVERY_RESULT: 'success' }).title, /version recording failed/);
  assert.match(releaseReport({ ...env, CHECKS_RESULT: 'failure' }).title, /blocked by checks/);
  assert.match(releaseReport({ ...env, PLAN_RESULT: 'failure', RELEASE_VERSION: '' }).title, /unplanned.*planning failed/);
  assert.match(releaseReport(env, 'start').title, /release started/);
});

test('missing Slack configuration does not send a message', async () => {
  assert.equal((await reportRelease(env, 'complete', async () => { throw new Error('Must not send'); })).slack, 'not-configured');
});

test('only a private Slack incoming webhook receives the message, with links and escaped text', async () => {
  const report = { ...releaseReport(env), title: 'Update <!channel>' };
  let posted;
  assert.equal(await notifySlack(report, webhook, async (url, request) => {
    assert.equal(url, webhook);
    assert.equal(request.method, 'POST');
    posted = JSON.parse(request.body);
    return { ok: true };
  }), 'sent');
  assert.ok(posted.text.includes('&lt;!channel&gt;'));
  assert.ok(posted.text.includes('https://github.com/CLX-Labs/cognition-curator/actions/runs/123'));
  for (const url of ['https://example.com/services/a/b/c', 'http://hooks.slack.com/services/a/b/c', webhook + '?secret=x'])
    await assert.rejects(notifySlack(report, url), /incoming webhook URL/);
});

test('network errors never expose the secret webhook and do not claim a successful notification', async () => {
  await assert.rejects(notifySlack(releaseReport(env), webhook, async () => { throw new Error('Failed ' + webhook); }),
    (error) => error.message === 'Slack notification could not connect.');
  await assert.rejects(notifySlack(releaseReport(env), webhook, async () => ({ ok: false, status: 403 })), /failed \(403\)/);
});
