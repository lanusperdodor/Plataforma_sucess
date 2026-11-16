import * as SQLite from 'expo-sqlite';
import type { Db, SqlValue } from './types';

export function wrapExpoDb(native: SQLite.SQLiteDatabase): Db {
  // Fila simples: garante que uma transação não se misture com consultas concorrentes.
  let queue: Promise<unknown> = Promise.resolve();
  let inTx = false;
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    if (inTx) return fn(); // chamadas feitas de dentro da transação corrente
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  };
  return {
    exec: (sql) => enqueue(() => native.execAsync(sql)),
    run: (sql, params = []) =>
      enqueue(async () => {
        const r = await native.runAsync(sql, params as SqlValue[]);
        return { lastInsertRowId: r.lastInsertRowId, changes: r.changes };
      }),
    all: <T>(sql: string, params: SqlValue[] = []) => enqueue(() => native.getAllAsync<T>(sql, params)),
    first: <T>(sql: string, params: SqlValue[] = []) => enqueue(() => native.getFirstAsync<T>(sql, params)),
    tx: <T>(fn: () => Promise<T>) =>
      enqueue(async () => {
        await native.execAsync('BEGIN');
        inTx = true;
        try {
          const out = await fn();
          await native.execAsync('COMMIT');
          return out;
        } catch (e) {
          await native.execAsync('ROLLBACK');
          throw e;
        } finally {
          inTx = false;
        }
      }),
  };
}

let opened: Promise<Db> | null = null;

export function openAppDb(): Promise<Db> {
  if (!opened) {
    opened = (async () => {
      const native = await SQLite.openDatabaseAsync('fluentia.db');
      try {
        await native.execAsync('PRAGMA journal_mode = WAL;');
      } catch {
        // WAL pode não existir em alguns ambientes (web); segue com o padrão.
      }
      return wrapExpoDb(native);
    })();
  }
  return opened;
}
