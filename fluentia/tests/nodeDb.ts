import { DatabaseSync } from 'node:sqlite';
import type { Db, SqlValue } from '../src/db/types';

/** Adaptador de testes: SQLite real (node:sqlite) atrás da mesma interface usada pelo app. */
export function createNodeDb(path = ':memory:'): Db & { close(): void } {
  const native = new DatabaseSync(path);
  return {
    async exec(sql) {
      native.exec(sql);
    },
    async run(sql, params: SqlValue[] = []) {
      const r = native.prepare(sql).run(...params);
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return native.prepare(sql).all(...params) as T[];
    },
    async first<T>(sql: string, params: SqlValue[] = []) {
      return (native.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async tx<T>(fn: () => Promise<T>) {
      native.exec('BEGIN');
      try {
        const out = await fn();
        native.exec('COMMIT');
        return out;
      } catch (e) {
        native.exec('ROLLBACK');
        throw e;
      }
    },
    close() {
      native.close();
    },
  };
}
