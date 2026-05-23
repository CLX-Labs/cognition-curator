#!/usr/bin/env node
/**
 * Railway start script.
 *
 * Handles two scenarios:
 *  1. Fresh DB (dev/new environment) — runs full migration history.
 *  2. Existing Flask DB on Railway — marks the baseline migration as already
 *     applied, then runs only new migrations (e.g. adding stytch_user_id).
 */

const { execSync } = require('child_process');
const { Client } = require('pg');

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL is not set');

  // Wait for Postgres to be reachable
  const pg = new Client({ connectionString: dbUrl });
  let attempts = 0;
  while (attempts < 30) {
    try {
      await pg.connect();
      console.log('Database connection established.');
      break;
    } catch {
      attempts++;
      console.log(`Waiting for database... (${attempts}/30)`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Check if the _prisma_migrations table exists (created by first migrate deploy)
  const { rows } = await pg.query(
    `SELECT EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public' AND tablename = '_prisma_migrations'
    ) AS exists`
  );
  await pg.end();

  const prismaTableExists = rows[0].exists === true || rows[0].exists === 't';

  if (!prismaTableExists) {
    // Existing Flask DB — mark the full baseline as already applied so Prisma
    // skips creating tables that already exist, then runs only new migrations.
    console.log('Existing database detected — baselining Prisma migration history...');
    execSync('npx prisma migrate resolve --applied "0_init"', { stdio: 'inherit' });
  }

  console.log('Running migrations...');
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });

  console.log('Starting server...');
  // Replace current process so Railway receives the correct PID
  const { execFileSync } = require('child_process');
  execFileSync('node', ['dist/app.js'], { stdio: 'inherit' });
}

main().catch((err) => {
  console.error('Start script failed:', err);
  process.exit(1);
});
