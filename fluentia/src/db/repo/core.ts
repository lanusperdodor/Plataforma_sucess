import { CONTENT_VERSION, CURRICULUM, LANG_CODES, type LangCode, type LessonContent, type Level } from '@/content';
import type { Db } from '../types';

export const nowIso = () => new Date().toISOString();

export interface Profile {
  id: number;
  name: string;
  native_lang: string;
  active_lang: LangCode;
  daily_minutes: number;
  created_at: string;
}

export interface LanguageRow {
  code: LangCode;
  active: number;
  weekdays: string;
  priority: number;
  started_at: string | null;
}

export async function getSetting(db: Db, key: string): Promise<string | null> {
  return (await db.first<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]))?.value ?? null;
}

export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

/** Cria perfil e idiomas na primeira execução e sincroniza o currículo embutido com as tabelas de curso. */
export async function bootstrap(db: Db): Promise<void> {
  const profile = await db.first('SELECT id FROM profile WHERE id = 1');
  if (!profile) {
    await db.run('INSERT INTO profile (id, created_at) VALUES (1, ?)', [nowIso()]);
  }
  for (const code of LANG_CODES) {
    await db.run('INSERT OR IGNORE INTO languages (code) VALUES (?)', [code]);
  }
  await db.run("INSERT OR IGNORE INTO goals (kind, target) VALUES ('weekly_lessons', 5)");
  await db.run("INSERT OR IGNORE INTO goals (kind, target) VALUES ('weekly_reviews', 50)");
  if ((await getSetting(db, 'content_version')) !== CONTENT_VERSION) {
    await syncCurriculum(db);
    await setSetting(db, 'content_version', CONTENT_VERSION);
  }
}

/** Grava (ou atualiza) cursos, unidades e lições embutidos. Lições geradas por IA não são tocadas. */
export async function syncCurriculum(db: Db): Promise<void> {
  await db.tx(async () => {
    for (const lang of LANG_CODES) {
      for (const c of CURRICULUM[lang]) {
        const courseId = `${lang}.${c.level.toLowerCase()}`;
        await db.run(
          'INSERT INTO courses (id, lang, level, title) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title',
          [courseId, lang, c.level, c.title]
        );
        let pos = 0;
        for (const u of c.units) {
          await db.run(
            `INSERT INTO units (id, course_id, lang, level, position, title, description, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'available')
             ON CONFLICT(id) DO UPDATE SET position = excluded.position, title = excluded.title, description = excluded.description, status = 'available'`,
            [u.id, courseId, lang, c.level, pos++, u.title, u.description]
          );
          let lp = 0;
          for (const l of u.lessons) {
            await db.run(
              `INSERT INTO lessons (id, unit_id, lang, level, position, title, objective, content_json, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'builtin')
               ON CONFLICT(id) DO UPDATE SET position = excluded.position, title = excluded.title, objective = excluded.objective, content_json = excluded.content_json`,
              [l.id, u.id, lang, c.level, lp++, l.title, l.objective, JSON.stringify(l)]
            );
          }
        }
        for (let i = 0; i < c.planned.length; i++) {
          const p = c.planned[i];
          const id = `${courseId}.p${i + 1}`;
          // Uma unidade planejada vira 'available' quando ganha lições (ex.: geradas por IA); não rebaixar.
          await db.run(
            `INSERT INTO units (id, course_id, lang, level, position, title, description, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'planned')
             ON CONFLICT(id) DO UPDATE SET position = excluded.position, title = excluded.title, description = excluded.description`,
            [id, courseId, lang, c.level, pos++, p.title, p.goals]
          );
        }
      }
    }
  });
}

export async function getProfile(db: Db): Promise<Profile> {
  const p = await db.first<Profile>('SELECT * FROM profile WHERE id = 1');
  if (!p) throw new Error('Perfil não inicializado');
  return p;
}

export async function updateProfile(db: Db, patch: Partial<Pick<Profile, 'name' | 'active_lang' | 'daily_minutes'>>): Promise<void> {
  if (patch.name !== undefined) await db.run('UPDATE profile SET name = ? WHERE id = 1', [patch.name]);
  if (patch.active_lang !== undefined) await db.run('UPDATE profile SET active_lang = ? WHERE id = 1', [patch.active_lang]);
  if (patch.daily_minutes !== undefined) {
    const m = Math.max(5, Math.min(240, Math.round(patch.daily_minutes)));
    await db.run('UPDATE profile SET daily_minutes = ? WHERE id = 1', [m]);
  }
}

export async function getLanguages(db: Db): Promise<LanguageRow[]> {
  const rows = await db.all<LanguageRow>('SELECT * FROM languages');
  return LANG_CODES.map((c) => rows.find((r) => r.code === c)!).filter(Boolean);
}

export async function updateLanguage(
  db: Db,
  code: LangCode,
  patch: { active?: boolean; weekdays?: number[]; priority?: number }
): Promise<void> {
  if (patch.active !== undefined) await db.run('UPDATE languages SET active = ? WHERE code = ?', [patch.active ? 1 : 0, code]);
  if (patch.weekdays) await db.run('UPDATE languages SET weekdays = ? WHERE code = ?', [JSON.stringify(patch.weekdays), code]);
  if (patch.priority !== undefined) await db.run('UPDATE languages SET priority = ? WHERE code = ?', [Math.max(1, Math.min(3, patch.priority)), code]);
}

// ---------- Cursos e lições ----------

export interface LessonRow {
  id: string;
  unit_id: string;
  lang: LangCode;
  level: Level;
  position: number;
  title: string;
  objective: string;
  source: 'builtin' | 'ai';
  status: 'started' | 'completed' | null;
  best_score: number | null;
}

export interface UnitRow {
  id: string;
  lang: LangCode;
  level: Level;
  position: number;
  title: string;
  description: string;
  status: 'available' | 'planned';
  lessons: LessonRow[];
}

/** Árvore completa de um idioma, na ordem de estudo, já com o progresso de cada lição. */
export async function getCourseTree(db: Db, lang: LangCode): Promise<UnitRow[]> {
  const units = await db.all<Omit<UnitRow, 'lessons'>>(
    `SELECT id, lang, level, position, title, description, status FROM units WHERE lang = ?
     ORDER BY CASE level WHEN 'A1' THEN 1 WHEN 'A2' THEN 2 WHEN 'B1' THEN 3 WHEN 'B2' THEN 4 WHEN 'C1' THEN 5 ELSE 6 END, position`,
    [lang]
  );
  const lessons = await db.all<LessonRow>(
    `SELECT l.id, l.unit_id, l.lang, l.level, l.position, l.title, l.objective, l.source, p.status, p.best_score
     FROM lessons l LEFT JOIN lesson_progress p ON p.lesson_id = l.id WHERE l.lang = ? ORDER BY l.position`,
    [lang]
  );
  return units.map((u) => ({ ...u, lessons: lessons.filter((l) => l.unit_id === u.id) }));
}

export function flattenLessons(tree: UnitRow[]): LessonRow[] {
  return tree.flatMap((u) => u.lessons);
}

export async function getLesson(db: Db, id: string): Promise<LessonContent | null> {
  const row = await db.first<{ content_json: string }>('SELECT content_json FROM lessons WHERE id = ?', [id]);
  return row ? (JSON.parse(row.content_json) as LessonContent) : null;
}

/** Lições concluídas do idioma, com conteúdo — base dos treinos livres. */
export async function getCompletedLessons(db: Db, lang: LangCode): Promise<LessonContent[]> {
  const rows = await db.all<{ content_json: string }>(
    `SELECT l.content_json FROM lessons l JOIN lesson_progress p ON p.lesson_id = l.id
     WHERE l.lang = ? AND p.status = 'completed' ORDER BY p.completed_at`,
    [lang]
  );
  return rows.map((r) => JSON.parse(r.content_json) as LessonContent);
}

/** Outras lições da mesma unidade: fornecem alternativas erradas plausíveis. */
export async function getUnitSiblings(db: Db, lessonId: string): Promise<LessonContent[]> {
  const rows = await db.all<{ content_json: string }>(
    'SELECT content_json FROM lessons WHERE unit_id = (SELECT unit_id FROM lessons WHERE id = ?) AND id != ?',
    [lessonId, lessonId]
  );
  return rows.map((r) => JSON.parse(r.content_json) as LessonContent);
}

/** Salva uma lição gerada por IA dentro de uma unidade planejada. */
export async function saveAiLesson(db: Db, unitId: string, lesson: LessonContent): Promise<void> {
  const unit = await db.first<{ lang: string; level: string }>('SELECT lang, level FROM units WHERE id = ?', [unitId]);
  if (!unit) throw new Error('Unidade não encontrada');
  const pos = (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM lessons WHERE unit_id = ?', [unitId]))?.n ?? 0;
  await db.tx(async () => {
    await db.run(
      `INSERT INTO lessons (id, unit_id, lang, level, position, title, objective, content_json, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ai')`,
      [lesson.id, unitId, unit.lang, unit.level, pos, lesson.title, lesson.objective, JSON.stringify(lesson)]
    );
    await db.run("UPDATE units SET status = 'available' WHERE id = ?", [unitId]);
  });
}
