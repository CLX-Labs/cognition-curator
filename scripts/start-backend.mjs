import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Run both processes in the existing Railway service. A failed worker must not
// leave an apparently healthy API accepting generation jobs nobody can finish.
export function startBackend({
  commands = [
    ['api', ['--import=tsx', 'apps/api/src/start.ts']],
    ['worker', ['--import=tsx', 'apps/worker/src/start.ts']],
  ],
  graceMs = 20_000,
} = {}) {
  const children = new Set();
  let stopping = false;
  let exitCode = 0;
  let timer;
  const finish = () => {
    if (children.size) return;
    clearTimeout(timer);
    process.removeListener('SIGTERM', terminate);
    process.removeListener('SIGINT', terminate);
    process.exitCode = exitCode;
  };
  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    exitCode = code;
    for (const child of children) child.kill('SIGTERM');
    timer = setTimeout(() => {
      for (const child of children) child.kill('SIGKILL');
    }, graceMs);
    timer.unref();
    finish();
  };
  const terminate = () => stop(0);
  process.once('SIGTERM', terminate);
  process.once('SIGINT', terminate);
  for (const [name, args] of commands) {
    const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
    children.add(child);
    child.once('error', () => {
      console.error(`Backend ${name} could not start.`);
      stop(1);
    });
    child.once('close', (code) => {
      children.delete(child);
      if (!stopping) {
        console.error(`Backend ${name} stopped unexpectedly (${code ?? 'signal'}).`);
        stop(code || 1);
      }
      finish();
    });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startBackend();
