import { createDatabase } from '@recollect/db';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
const config = loadConfig(),
  db = createDatabase(config.databaseUrl);
const app = await buildApp({ db, config, logger: true });
await app.listen({
  host: process.env.HOST ?? (config.production ? '0.0.0.0' : '127.0.0.1'),
  port: Number(process.env.PORT ?? 3001),
});
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await app.close();
  await db.end();
};
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
