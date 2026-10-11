import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createDatabase, transaction, type Database } from './index.js';
export async function migrate(db: Database): Promise<void> {
  await transaction(db, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('recollect.schema.migrations'))");
    await tx.query('CREATE SCHEMA IF NOT EXISTS recollect');
    await tx.query(
      'CREATE TABLE IF NOT EXISTS recollect.schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
    for (const name of (await readdir(directory)).filter((n) => n.endsWith('.sql')).sort()) {
      if (
        (await tx.query('SELECT 1 FROM recollect.schema_migrations WHERE name=$1', [name])).rowCount
      )
        continue;
      await tx.query(await readFile(resolve(directory, name), 'utf8'));
      await tx.query('INSERT INTO recollect.schema_migrations(name) VALUES($1)', [name]);
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL || process.env.CONFIRM_DATABASE_MIGRATION !== 'yes')
    throw new Error(
      'Set DATABASE_URL and CONFIRM_DATABASE_MIGRATION=yes after reviewing the target.',
    );
  const db = createDatabase(process.env.DATABASE_URL);
  try {
    await migrate(db);
    process.stdout.write('Recollect additive migrations applied.\n');
  } finally {
    await db.end();
  }
}
