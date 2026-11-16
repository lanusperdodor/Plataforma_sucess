import type { Db } from './types';

/**
 * Migrações versionadas (PRAGMA user_version).
 * Regra: nunca editar uma migração já publicada — sempre acrescentar uma nova no fim.
 */
export const MIGRATIONS: string[] = [
  // v1 — esquema inicial
  `
  CREATE TABLE profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL DEFAULT '',
    native_lang TEXT NOT NULL DEFAULT 'pt-BR',
    active_lang TEXT NOT NULL DEFAULT 'en',
    daily_minutes INTEGER NOT NULL DEFAULT 30,
    created_at TEXT NOT NULL
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  CREATE TABLE languages (
    code TEXT PRIMARY KEY NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    weekdays TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
    priority INTEGER NOT NULL DEFAULT 1,
    started_at TEXT
  );
  CREATE TABLE courses (
    id TEXT PRIMARY KEY NOT NULL,
    lang TEXT NOT NULL,
    level TEXT NOT NULL,
    title TEXT NOT NULL,
    exam_ref TEXT
  );
  CREATE TABLE units (
    id TEXT PRIMARY KEY NOT NULL,
    course_id TEXT NOT NULL REFERENCES courses(id),
    lang TEXT NOT NULL,
    level TEXT NOT NULL,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'available'
  );
  CREATE TABLE lessons (
    id TEXT PRIMARY KEY NOT NULL,
    unit_id TEXT NOT NULL REFERENCES units(id),
    lang TEXT NOT NULL,
    level TEXT NOT NULL,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    objective TEXT NOT NULL DEFAULT '',
    content_json TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'builtin'
  );
  CREATE INDEX idx_lessons_lang ON lessons(lang, level, position);
  CREATE TABLE lesson_progress (
    lesson_id TEXT PRIMARY KEY NOT NULL,
    lang TEXT NOT NULL,
    status TEXT NOT NULL,
    best_score REAL NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    last_at TEXT NOT NULL
  );
  CREATE TABLE attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lang TEXT NOT NULL,
    lesson_id TEXT,
    item_id TEXT,
    exercise_type TEXT NOT NULL,
    skill TEXT NOT NULL,
    correct INTEGER,
    user_answer TEXT,
    expected TEXT,
    context TEXT NOT NULL,
    day TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_attempts_lang_day ON attempts(lang, day);
  CREATE TABLE vocabulary (
    item_id TEXT PRIMARY KEY NOT NULL,
    lang TEXT NOT NULL,
    lesson_id TEXT,
    term TEXT NOT NULL,
    reading TEXT,
    translation TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'word',
    learned_at TEXT NOT NULL,
    correct_count INTEGER NOT NULL DEFAULT 0,
    wrong_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_vocab_lang ON vocabulary(lang);
  CREATE TABLE reviews (
    item_id TEXT PRIMARY KEY NOT NULL REFERENCES vocabulary(item_id) ON DELETE CASCADE,
    lang TEXT NOT NULL,
    due TEXT NOT NULL,
    stability REAL NOT NULL,
    difficulty REAL NOT NULL,
    elapsed_days REAL NOT NULL DEFAULT 0,
    scheduled_days REAL NOT NULL DEFAULT 0,
    learning_steps INTEGER NOT NULL DEFAULT 0,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    state INTEGER NOT NULL DEFAULT 0,
    last_review TEXT
  );
  CREATE INDEX idx_reviews_due ON reviews(lang, due);
  CREATE TABLE review_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    lang TEXT NOT NULL,
    rating INTEGER NOT NULL,
    state_before INTEGER NOT NULL,
    day TEXT NOT NULL,
    reviewed_at TEXT NOT NULL
  );
  CREATE TABLE assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lang TEXT NOT NULL,
    lesson_id TEXT NOT NULL,
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    passed INTEGER NOT NULL,
    skills_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lang TEXT NOT NULL,
    scenario_id TEXT NOT NULL,
    title TEXT NOT NULL,
    level TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    reading TEXT,
    translation TEXT,
    feedback_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_messages_conv ON messages(conversation_id, id);
  CREATE TABLE writing_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lang TEXT NOT NULL,
    task_type TEXT NOT NULL,
    prompt TEXT NOT NULL,
    text TEXT NOT NULL,
    feedback_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE goals (
    kind TEXT PRIMARY KEY NOT NULL,
    target INTEGER NOT NULL
  );
  CREATE TABLE study_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lang TEXT NOT NULL,
    activity TEXT NOT NULL,
    seconds INTEGER NOT NULL,
    day TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_sessions_day ON study_sessions(day, lang);
  CREATE TABLE xp_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lang TEXT NOT NULL,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    day TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE achievements (id TEXT PRIMARY KEY NOT NULL, unlocked_at TEXT NOT NULL);
  CREATE TABLE ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    day TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export async function migrate(db: Db): Promise<{ from: number; to: number }> {
  await db.exec('PRAGMA foreign_keys = ON;');
  const row = await db.first<{ user_version: number }>('PRAGMA user_version');
  const from = row?.user_version ?? 0;
  if (from > SCHEMA_VERSION) {
    throw new Error(
      `O banco de dados (v${from}) é mais novo que esta versão do app (v${SCHEMA_VERSION}). Atualize o Fluentia.`
    );
  }
  for (let v = from; v < SCHEMA_VERSION; v++) {
    await db.tx(async () => {
      await db.exec(MIGRATIONS[v]);
      await db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return { from, to: SCHEMA_VERSION };
}

/** Todas as tabelas com dados do usuário, na ordem segura para restauração (pais antes de filhos). */
export const USER_TABLES = [
  'profile',
  'settings',
  'languages',
  'goals',
  'lesson_progress',
  'attempts',
  'vocabulary',
  'reviews',
  'review_log',
  'assessments',
  'conversations',
  'messages',
  'writing_submissions',
  'study_sessions',
  'xp_log',
  'achievements',
  'ai_usage',
] as const;
