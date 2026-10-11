import * as SQLite from 'expo-sqlite';
import type { SqlDatabase, SqlExecutor } from './repository';

function executor(db: SQLite.SQLiteDatabase): SqlExecutor {
  return {
    exec: async (sql) => {
      await db.execAsync(sql);
    },
    run: async (sql, params = []) => {
      await db.runAsync(sql, params as SQLite.SQLiteBindValue[]);
    },
    all: <T>(sql: string, params: unknown[] = []) =>
      db.getAllAsync<T>(sql, params as SQLite.SQLiteBindValue[]),
  };
}

export async function openDatabase(): Promise<SqlDatabase> {
  const db = await SQLite.openDatabaseAsync('recollect-v2.db');
  await db.execAsync('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  return {
    ...executor(db),
    transaction: async (work) => {
      let result: unknown;
      await db.withExclusiveTransactionAsync(async (tx) => {
        result = await work(executor(tx));
      });
      return result as never;
    },
  };
}
