/** Abstração mínima de banco: implementada por expo-sqlite no app e node:sqlite nos testes. */
export type SqlValue = string | number | null;

export interface RunResult {
  lastInsertRowId: number;
  changes: number;
}

export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<RunResult>;
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T | null>;
  /** Executa fn em uma transação; desfaz tudo se fn rejeitar. */
  tx<T>(fn: () => Promise<T>): Promise<T>;
}
