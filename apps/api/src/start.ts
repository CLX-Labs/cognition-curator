import { createDatabase } from '@recollect/db';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { processAccountDeletions } from './account-deletion.js';
const config = loadConfig(),
  db = createDatabase(config.databaseUrl);
const app = await buildApp({ db, config, logger: true });
await app.listen({
  host: process.env.HOST ?? (config.production ? '0.0.0.0' : '127.0.0.1'),
  port: Number(process.env.PORT ?? 3001),
});
let stopping = false;
let processing: Promise<unknown> | null = null;
const processDeletions = () => {
  if (stopping || processing) return;
  processing = processAccountDeletions(db, config)
    .then((result) => {
      if (result.completed || result.pending)
        app.log.info({ component: 'account-deletion', ...result }, 'Account deletion processing');
    })
    .catch(() =>
      app.log.error({ component: 'account-deletion' }, 'Account deletion processing failed'),
    )
    .finally(() => {
      processing = null;
    });
};
const deletionTimer = setInterval(processDeletions, 60_000);
deletionTimer.unref();
processDeletions();
const stop = async () => {
  if (stopping) return;
  stopping = true;
  clearInterval(deletionTimer);
  await processing;
  await app.close();
  await db.end();
};
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
