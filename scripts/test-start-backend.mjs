import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const launcher = new URL('./start-backend.mjs', import.meta.url).href;
const launch = (commands) => spawn(process.execPath, ['--input-type=module', '-e',
  `import { startBackend } from ${JSON.stringify(launcher)}; startBackend({ commands: ${JSON.stringify(commands)}, graceMs: 500 });`],
  { stdio: ['ignore', 'pipe', 'pipe'] });

test('a worker startup failure terminates the API and reports failure', { timeout: 5000 }, async () => {
  const supervisor = launch([
    ['api', ['-e', 'setInterval(() => {}, 1000)']],
    ['worker', ['-e', 'process.exit(7)']],
  ]);
  let output = '';
  supervisor.stderr.on('data', chunk => { output += chunk; });
  const [code] = await once(supervisor, 'close');
  assert.equal(code, 7);
  assert.match(output, /worker stopped unexpectedly/);
});

test('Railway termination shuts down both processes cleanly', { timeout: 5000 }, async () => {
  const supervisor = launch([
    ['api', ['-e', 'console.log("ready"); setInterval(() => {}, 1000)']],
    ['worker', ['-e', 'setInterval(() => {}, 1000)']],
  ]);
  await once(supervisor.stdout, 'data');
  const closed = once(supervisor, 'close');
  supervisor.kill('SIGTERM');
  const [code] = await closed;
  assert.equal(code, 0);
});
