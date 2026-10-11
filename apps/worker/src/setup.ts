import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { PgBoss } from 'pg-boss';
/** Explicit deployment step, separate from ordinary worker startup. Review pinned pg-boss migrations before upgrades. */
export async function setupQueue(databaseUrl: string): Promise<void> {
  const boss = new PgBoss({ connectionString: databaseUrl, schema: 'recollect_boss' });
  boss.on('error', () => {});
  try {
    await boss.start();
    await boss.createQueue('recollect-generation', {
      retryLimit: 3,
      retryDelay: 30,
      expireInSeconds: 180,
    });
  } finally {
    await boss.stop();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL || process.env.CONFIRM_QUEUE_SETUP !== 'yes')
    throw new Error(
      'Set DATABASE_URL and CONFIRM_QUEUE_SETUP=yes only after reviewing this database target and pinned queue migrations.',
    );
  await setupQueue(process.env.DATABASE_URL);
  process.stdout.write('Recollect queue schema initialized.\n');
}
