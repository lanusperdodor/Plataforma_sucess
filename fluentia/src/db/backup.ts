import { SCHEMA_VERSION, USER_TABLES } from './migrations';
import type { Db, SqlValue } from './types';

export const BACKUP_FORMAT = 'fluentia-backup';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  tables: Record<string, Record<string, SqlValue>[]>;
}

/** Exporta todos os dados do usuário. Chaves e tokens (armazenamento seguro) NÃO entram no backup. */
export async function exportBackup(db: Db): Promise<BackupFile> {
  const tables: BackupFile['tables'] = {};
  for (const t of USER_TABLES) {
    tables[t] = await db.all<Record<string, SqlValue>>(`SELECT * FROM ${t}`);
  }
  // Lições geradas por IA são dados do usuário; as embutidas voltam sozinhas com o app.
  tables.ai_lessons = await db.all<Record<string, SqlValue>>("SELECT * FROM lessons WHERE source = 'ai'");
  return { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), tables };
}

export function parseBackup(json: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('O arquivo não é um backup válido (JSON inválido).');
  }
  const b = data as Partial<BackupFile>;
  if (!b || b.format !== BACKUP_FORMAT || typeof b.tables !== 'object' || b.tables === null) {
    throw new Error('O arquivo não é um backup do Fluentia.');
  }
  if (typeof b.schemaVersion !== 'number' || b.schemaVersion > SCHEMA_VERSION) {
    throw new Error('Este backup foi criado por uma versão mais nova do Fluentia. Atualize o app para restaurá-lo.');
  }
  return b as BackupFile;
}

export function summarizeBackup(b: BackupFile): { lessons: number; words: number; conversations: number; exportedAt: string } {
  const count = (t: string) => b.tables[t]?.length ?? 0;
  return {
    lessons: (b.tables.lesson_progress ?? []).filter((r) => r.status === 'completed').length,
    words: count('vocabulary'),
    conversations: count('conversations'),
    exportedAt: b.exportedAt,
  };
}

async function columnsOf(db: Db, table: string): Promise<Set<string>> {
  const rows = await db.all<{ name: string }>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((r) => r.name));
}

/**
 * Restaura um backup SUBSTITUINDO os dados atuais. Tudo ocorre em uma transação:
 * se algo falhar, os dados atuais permanecem intactos. A confirmação do usuário é feita na tela.
 */
export async function restoreBackup(db: Db, backup: BackupFile): Promise<void> {
  await db.exec('PRAGMA foreign_keys = OFF;');
  try {
    await db.tx(async () => {
      for (const t of [...USER_TABLES].reverse()) await db.exec(`DELETE FROM ${t}`);
      await db.exec("DELETE FROM lessons WHERE source = 'ai'");
      const insert = async (table: string, rows: Record<string, SqlValue>[]) => {
        const cols = await columnsOf(db, table);
        for (const row of rows) {
          // Só colunas que existem neste esquema: permite restaurar backups de versões anteriores.
          const keys = Object.keys(row).filter((k) => cols.has(k));
          if (!keys.length) continue;
          await db.run(
            `INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
            keys.map((k) => row[k] ?? null)
          );
        }
      };
      await insert('lessons', backup.tables.ai_lessons ?? []);
      for (const t of USER_TABLES) await insert(t, backup.tables[t] ?? []);
      await db.run("UPDATE units SET status = 'available' WHERE id IN (SELECT unit_id FROM lessons WHERE source = 'ai')");
      // Força a ressincronização do currículo embutido na próxima abertura.
      await db.run("DELETE FROM settings WHERE key = 'content_version'");
    });
  } finally {
    await db.exec('PRAGMA foreign_keys = ON;');
  }
}

/** Apaga todo o progresso e histórico (mantém o currículo). A confirmação é feita na tela. */
export async function wipeUserData(db: Db): Promise<void> {
  await db.exec('PRAGMA foreign_keys = OFF;');
  try {
    await db.tx(async () => {
      for (const t of [...USER_TABLES].reverse()) await db.exec(`DELETE FROM ${t}`);
      await db.exec("DELETE FROM lessons WHERE source = 'ai'");
      await db.exec("UPDATE units SET status = 'planned' WHERE id LIKE '%.p%' AND id NOT IN (SELECT unit_id FROM lessons)");
    });
  } finally {
    await db.exec('PRAGMA foreign_keys = ON;');
  }
}
