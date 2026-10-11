import { createHash } from 'node:crypto';
import pg from 'pg';
export type { PoolClient } from 'pg';
export const { Pool } = pg;
export type Database = pg.Pool;
export type Transaction = pg.PoolClient;
export function createDatabase(url: string): Database {
  return new Pool({ connectionString: url, max: 10 });
}
export async function transaction<T>(
  db: Database,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const tx = await db.connect();
  try {
    await tx.query('BEGIN');
    const result = await work(tx);
    await tx.query('COMMIT');
    return result;
  } catch (error) {
    await tx.query('ROLLBACK');
    throw error;
  } finally {
    tx.release();
  }
}
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ':' + stableJson(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
export function hash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}
export function secretHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export async function lockOwner(tx: Transaction, owner: string): Promise<bigint> {
  await tx.query('INSERT INTO recollect.sync_heads(owner_id) VALUES($1) ON CONFLICT DO NOTHING', [
    owner,
  ]);
  const r = await tx.query<{ revision: string }>(
    'SELECT revision::text FROM recollect.sync_heads WHERE owner_id=$1 FOR UPDATE',
    [owner],
  );
  return BigInt(r.rows[0]!.revision);
}
export type Change = { entity: 'deck' | 'card' | 'review'; data: unknown };
export async function appendChanges(
  tx: Transaction,
  owner: string,
  changes: Change[],
): Promise<string> {
  const r = await tx.query<{ revision: string }>(
    'UPDATE recollect.sync_heads SET revision=revision+1 WHERE owner_id=$1 RETURNING revision::text',
    [owner],
  );
  const revision = r.rows[0]!.revision;
  for (const [index, change] of changes.entries())
    await tx.query(
      'INSERT INTO recollect.changes(owner_id,revision,ordinal,entity,data) VALUES($1,$2,$3,$4,$5)',
      [owner, revision, index, change.entity, change.data],
    );
  return revision;
}
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
  ) {
    super(message);
  }
}
