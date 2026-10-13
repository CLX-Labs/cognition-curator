import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

function safeError(error, env) {
  let message = error instanceof Error ? error.message : 'Unknown setup failure';
  for (const [name, value] of Object.entries(env)) {
    if (/SECRET|TOKEN|PASSWORD|API_KEY|DATABASE_URL/i.test(name) && value?.length >= 4)
      message = message.replaceAll(value, '[redacted]');
  }
  message = message.replace(/(postgres(?:ql)?:\/\/)[^\s@]+@/gi, '$1[redacted]@');
  return { name: error?.name ?? 'Error', code: error?.code ?? null, message };
}

async function migrateDatabase(url) {
  const { Pool } = await import('../packages/db/src/index.ts');
  const { migrate } = await import('../packages/db/src/migrate.ts');
  const db = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  try { await migrate(db); }
  finally { await db.end(); }
}

async function initializeQueue(url) {
  const { setupQueue } = await import('../apps/worker/src/setup.ts');
  await setupQueue(url);
}

// This is an explicit deployment command, never ordinary API/worker startup.
// No shell expansion, npm workspace cwd, or inline environment assignments.
export async function setupBackend(env = process.env, {
  migration = migrateDatabase,
  queue = initializeQueue,
  log = entry => console.log(JSON.stringify(entry)),
  nodeVersion = process.versions.node,
} = {}) {
  let stage = 'configuration';
  try {
    log({ component: 'backend-setup', stage, status: 'starting', nodeVersion });
    if (Number(nodeVersion.split('.')[0]) !== 24) throw new Error('Backend setup requires Node 24.');
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required for backend setup.');
    for (const [name, work] of [['migration', migration], ['queue', queue]]) {
      stage = name;
      log({ component: 'backend-setup', stage, status: 'starting' });
      await work(env.DATABASE_URL);
      log({ component: 'backend-setup', stage, status: 'complete' });
    }
    log({ component: 'backend-setup', stage: 'ready', status: 'complete' });
  } catch (error) {
    log({ component: 'backend-setup', stage, status: 'failed', error: safeError(error, env) });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await setupBackend(); }
  catch { process.exitCode = 1; }
}
