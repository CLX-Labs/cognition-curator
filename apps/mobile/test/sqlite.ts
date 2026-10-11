import { DatabaseSync } from 'node:sqlite';
import type { SqlDatabase, SqlExecutor } from '../src/repository';

/** The same repository runs against SQLite, not a mock of SQL semantics. */
export class TestDatabase implements SqlDatabase {
  readonly sqlite: DatabaseSync;
  failOn: string | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(path = ':memory:') {
    this.sqlite = new DatabaseSync(path);
  }
  exec = async (sql: string) => {
    this.sqlite.exec(sql);
  };
  run = async (sql: string, params: unknown[] = []) => {
    if (this.failOn && sql.includes(this.failOn)) {
      this.failOn = null;
      throw new Error('Simulated disk write failure');
    }
    this.sqlite.prepare(sql).run(...(params as never[]));
  };
  all = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
    this.sqlite.prepare(sql).all(...(params as never[])) as T[];
  transaction<T>(work: (db: SqlExecutor) => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => {
      this.sqlite.exec('BEGIN IMMEDIATE;');
      try {
        const result = await work(this);
        this.sqlite.exec('COMMIT;');
        return result;
      } catch (cause) {
        this.sqlite.exec('ROLLBACK;');
        throw cause;
      }
    });
    this.tail = next.catch(() => undefined);
    return next;
  }
  close() {
    this.sqlite.close();
  }
}
