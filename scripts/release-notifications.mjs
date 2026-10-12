import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const escapeSlack = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function releaseReport(env, phase = 'complete') {
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '') ||
    !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '') || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? ''))
    throw new Error('A GitHub release run identity is required.');
  if (!['start', 'complete'].includes(phase)) throw new Error('Notification phase must be start or complete.');
  const version = /^\d+\.\d+\.\d+$/.test(env.RELEASE_VERSION ?? '') ? env.RELEASE_VERSION : 'unplanned';
  const kind = env.RELEASE_TYPE === 'native' ? 'Native TestFlight' : env.RELEASE_TYPE === 'ota' ? 'OTA' : 'App';
  const success = env.RELEASE_RESULT === 'success';
  let title;
  if (phase === 'start') title = `${version} · ${kind} release started`;
  else if (success) title = `${version} · ${env.RELEASE_TYPE === 'native' ? 'Native build submitted to TestFlight' : 'OTA published'}`;
  else if (env.DELIVERY_RESULT === 'success') title = `${version} · App released; version recording failed`;
  else if (env.CHECKS_RESULT !== 'success') title = `${version} · Release blocked by checks`;
  else if (env.PLAN_RESULT !== 'success') title = `${version} · Release planning failed`;
  else title = `${version} · Release failed`;
  const runUrl = `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const commitUrl = `https://github.com/${env.GITHUB_REPOSITORY}/commit/${env.GITHUB_SHA}`;
  return { title, runUrl, commitUrl, commit: env.GITHUB_SHA.slice(0, 7),
    detail: phase === 'start' ? 'API and worker deployment must pass before the app ships.' :
      success ? env.RELEASE_TYPE === 'native' ? 'Install through TestFlight after Apple processing. Check You → App version.' :
        'Reopen the app or use Restart when the update prompt appears. Check You → App version.' :
      env.DELIVERY_RESULT === 'success' ? 'Delivery succeeded, but the release tag was not recorded. Inspect the run before releasing again.' :
        'The pipeline did not confirm an app release. Inspect the failing step before retrying.' };
}

export async function notifySlack(report, webhook, fetcher = fetch) {
  if (!webhook) return 'not-configured';
  let url;
  try { url = new URL(webhook); } catch { throw new Error('SLACK_RELEASE_WEBHOOK must be a Slack incoming webhook URL.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'hooks.slack.com' || !/^\/services\/[^/]+\/[^/]+\/[^/]+$/.test(url.pathname) ||
    url.username || url.password || url.search || url.hash)
    throw new Error('SLACK_RELEASE_WEBHOOK must be a Slack incoming webhook URL.');
  let response;
  try {
    response = await fetcher(url.href, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ text: `Recollect · ${escapeSlack(report.title)}\nCommit: <${report.commitUrl}|${report.commit}>\n${escapeSlack(report.detail)}\n<${report.runUrl}|GitHub release run> · <https://expo.dev/accounts/collectsoftware/projects/recollect-ai|Expo project>` }),
    });
  } catch { throw new Error('Slack notification could not connect.'); }
  if (!response.ok) throw new Error(`Slack notification failed (${response.status}).`);
  return 'sent';
}

export async function reportRelease(env, phase, fetcher = fetch) {
  const report = releaseReport(env, phase);
  // The GitHub summary remains available even without a Slack connection.
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY,
    `## ${report.title}\n\n${report.detail}\n\n[Commit ${report.commit}](${report.commitUrl}) · [Release run](${report.runUrl}) · ` +
    '[Expo project](https://expo.dev/accounts/collectsoftware/projects/recollect-ai)\n');
  const slack = await notifySlack(report, env.SLACK_RELEASE_WEBHOOK, fetcher);
  console.log(`${report.title}. Slack: ${slack}.`);
  return { report, slack };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await reportRelease(process.env, process.argv[2] ?? 'complete');
}
