/**
 * Banco na versão web (navegador e claude.ai): SQLite real compilado para WebAssembly (sql.js),
 * rodando na própria página (sem worker, que o claude.ai não permite) e salvo no IndexedDB do navegador.
 * Os mesmos repositórios e migrações do app Android rodam por cima desta implementação.
 */
import type { Db, SqlValue } from './types';

interface SqlJsStatement {
  bind(values: SqlValue[]): boolean;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
}
interface SqlJsDatabase {
  exec(sql: string): unknown;
  run(sql: string, params?: SqlValue[]): void;
  prepare(sql: string): SqlJsStatement;
  export(): Uint8Array;
  getRowsModified(): number;
}
interface SqlJsStatic {
  Database: new (data?: Uint8Array) => SqlJsDatabase;
}
declare global {
  interface Window {
    initSqlJs?: (config: { wasmBinary?: ArrayBuffer; locateFile?: (f: string) => string }) => Promise<SqlJsStatic>;
  }
}

const IDB_NAME = 'fluentia';
const IDB_STORE = 'db';
const IDB_KEY = 'main';

function idb(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}

async function loadBytes(): Promise<Uint8Array | null> {
  try {
    const d = await idb();
    return await new Promise((ok) => {
      const req = d.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => ok(req.result ? new Uint8Array(req.result as ArrayBuffer) : null);
      req.onerror = () => ok(null);
    });
  } catch {
    return null;
  }
}

async function saveBytes(bytes: Uint8Array): Promise<void> {
  const d = await idb();
  await new Promise<void>((ok, fail) => {
    const tx = d.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), IDB_KEY);
    tx.oncomplete = () => ok();
    tx.onerror = () => fail(tx.error);
  });
}

function loadScript(src: string): Promise<void> {
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => ok();
    s.onerror = () => fail(new Error(`Não foi possível carregar ${src}`));
    document.head.appendChild(s);
  });
}

/** Caminho dos arquivos publicados junto com a página (respeita a tag <base> da versão claude.ai). */
const asset = (p: string) => new URL(p, document.baseURI).toString();

export function wrapSqlJs(native: SqlJsDatabase, persist: () => void): Db {
  let inTx = false;
  const all = <T>(sql: string, params: SqlValue[] = []): T[] => {
    const st = native.prepare(sql);
    try {
      st.bind(params);
      const rows: T[] = [];
      while (st.step()) rows.push(st.getAsObject() as T);
      return rows;
    } finally {
      st.free();
    }
  };
  const changed = () => {
    if (!inTx) persist();
  };
  return {
    async exec(sql) {
      native.exec(sql);
      if (!/^\s*PRAGMA\s+(foreign_keys|journal_mode)/i.test(sql)) changed();
    },
    async run(sql, params = []) {
      native.run(sql, params);
      const changes = native.getRowsModified();
      const id = all<{ id: number }>('SELECT last_insert_rowid() AS id')[0]?.id ?? 0;
      changed();
      return { lastInsertRowId: Number(id), changes };
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return all<T>(sql, params);
    },
    async first<T>(sql: string, params: SqlValue[] = []) {
      return all<T>(sql, params)[0] ?? null;
    },
    async tx<T>(fn: () => Promise<T>) {
      if (inTx) return fn();
      native.exec('BEGIN');
      inTx = true;
      try {
        const out = await fn();
        native.exec('COMMIT');
        return out;
      } catch (e) {
        native.exec('ROLLBACK');
        throw e;
      } finally {
        inTx = false;
        persist();
      }
    },
  };
}

let opened: Promise<Db> | null = null;

export function openAppDb(): Promise<Db> {
  if (!opened) {
    opened = (async () => {
      if (!window.initSqlJs) await loadScript(asset('sqljs/sql-wasm.js'));
      const wasm = await (await fetch(asset('sqljs/sql-wasm.wasm'))).arrayBuffer();
      const SQL = await window.initSqlJs!({ wasmBinary: wasm });
      const native = new SQL.Database((await loadBytes()) ?? undefined);
      // Grava no IndexedDB pouco depois de cada mudança e ao esconder a página.
      let timer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        saveBytes(native.export()).catch(() => undefined);
      };
      const persist = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, 400);
      };
      document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
      window.addEventListener('pagehide', flush);
      return wrapSqlJs(native, persist);
    })();
  }
  return opened;
}
