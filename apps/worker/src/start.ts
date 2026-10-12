import { createDatabase } from '@recollect/db';
import { AnthropicProvider } from '@recollect/ai';
import { startWorker } from './worker.js';
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is required. Run explicit schema migrations before starting.');
const db = createDatabase(process.env.DATABASE_URL);
const provider = new AnthropicProvider(
  process.env.ANTHROPIC_API_KEY ?? '',
  process.env.ANTHROPIC_MODEL ?? '',
);
const stop = await startWorker(db, process.env.DATABASE_URL, provider);
process.stdout.write('Recollect generation worker ready.\n');
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await stop();
  await db.end();
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
