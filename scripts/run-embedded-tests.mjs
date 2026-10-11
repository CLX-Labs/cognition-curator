import { spawn } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

// Always an ephemeral local database. This command never uses DATABASE_URL from the shell.
// PGlite runs PostgreSQL in WASM; CI additionally tests independent PG16 connections.
const db = await PGlite.create({ extensions: { pgcrypto } });
const server = new PGLiteSocketServer({ db, port: 54329, host: '127.0.0.1', maxConnections: 10 });
try {
  await server.start();
  const child = spawn(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run', ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54329/postgres',
        RECOLLECT_EMBEDDED_TEST: 'true',
      },
    },
  );
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
} finally {
  await server.stop();
  await db.close();
}
