import type { Item, LangCode, LessonContent, Level } from '@/content';
import { LEVELS } from '@/content';
import type { ExerciseType, SessionScore, Skill } from '@/domain/exercises';
import { XP } from '@/domain/gamification';
import { applyRating, newReviewRow, Rating, type Grade, type ReviewRow } from '@/domain/srs';
import { todayKey } from '@/domain/text';
import type { Db } from '../types';
import { flattenLessons, getCourseTree, nowIso, type LessonRow } from './core';

export async function addXp(db: Db, lang: LangCode, amount: number, reason: string): Promise<void> {
  if (amount <= 0) return;
  await db.run('INSERT INTO xp_log (lang, amount, reason, day, created_at) VALUES (?, ?, ?, ?, ?)', [lang, amount, reason, todayKey(), nowIso()]);
}

export async function addStudyTime(db: Db, lang: LangCode, activity: string, seconds: number): Promise<void> {
  const s = Math.round(seconds);
  if (s < 3) return;
  // Limite por registro: protege contra app esquecido aberto.
  await db.run('INSERT INTO study_sessions (lang, activity, seconds, day, created_at) VALUES (?, ?, ?, ?, ?)', [lang, activity, Math.min(s, 1800), todayKey(), nowIso()]);
  await db.run('UPDATE languages SET started_at = COALESCE(started_at, ?) WHERE code = ?', [nowIso(), lang]);
}

export interface AttemptInput {
  lang: LangCode;
  lessonId: string | null;
  itemId: string | null;
  type: ExerciseType | 'review' | 'conversation' | 'writing';
  skill: Skill;
  /** null = não avaliado (ex.: fala sem reconhecimento disponível). */
  correct: boolean | null;
  userAnswer?: string;
  expected?: string;
  context: 'practice' | 'assessment' | 'review' | 'drill';
}

/** Registra uma resposta. Só respostas avaliadas contam para acertos, erros e XP. */
export async function recordAttempt(db: Db, a: AttemptInput): Promise<void> {
  await db.run(
    `INSERT INTO attempts (lang, lesson_id, item_id, exercise_type, skill, correct, user_answer, expected, context, day, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [a.lang, a.lessonId, a.itemId, a.type, a.skill, a.correct === null ? null : a.correct ? 1 : 0, a.userAnswer ?? null, a.expected ?? null, a.context, todayKey(), nowIso()]
  );
  if (a.correct === null) return;
  if (a.itemId) {
    await db.run(
      `UPDATE vocabulary SET correct_count = correct_count + ?, wrong_count = wrong_count + ? WHERE item_id = ?`,
      [a.correct ? 1 : 0, a.correct ? 0 : 1, a.itemId]
    );
    // Errar um item já aprendido fora da revisão antecipa a revisão dele.
    if (!a.correct && a.context !== 'review') {
      await db.run('UPDATE reviews SET due = ? WHERE item_id = ? AND due > ?', [nowIso(), a.itemId, nowIso()]);
    }
  }
  await addXp(db, a.lang, a.correct ? XP.exerciseCorrect : XP.exerciseTried, a.context);
}

export async function markLessonStarted(db: Db, lessonId: string, lang: LangCode): Promise<void> {
  const now = nowIso();
  await db.run(
    `INSERT INTO lesson_progress (lesson_id, lang, status, started_at, last_at) VALUES (?, ?, 'started', ?, ?)
     ON CONFLICT(lesson_id) DO UPDATE SET last_at = excluded.last_at`,
    [lessonId, lang, now, now]
  );
  await db.run('UPDATE languages SET started_at = COALESCE(started_at, ?) WHERE code = ?', [now, lang]);
}

async function learnItem(db: Db, lang: LangCode, lessonId: string, item: Item, now: Date): Promise<void> {
  const res = await db.run(
    `INSERT OR IGNORE INTO vocabulary (item_id, lang, lesson_id, term, reading, translation, kind, learned_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [item.id, lang, lessonId, item.t, item.r ?? null, item.pt, item.kind, now.toISOString()]
  );
  if (res.changes > 0) await saveReview(db, newReviewRow(item.id, lang, now));
}

async function saveReview(db: Db, r: ReviewRow): Promise<void> {
  await db.run(
    `INSERT INTO reviews (item_id, lang, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET due = excluded.due, stability = excluded.stability, difficulty = excluded.difficulty,
       elapsed_days = excluded.elapsed_days, scheduled_days = excluded.scheduled_days, learning_steps = excluded.learning_steps,
       reps = excluded.reps, lapses = excluded.lapses, state = excluded.state, last_review = excluded.last_review`,
    [r.item_id, r.lang, r.due, r.stability, r.difficulty, r.elapsed_days, r.scheduled_days, r.learning_steps, r.reps, r.lapses, r.state, r.last_review]
  );
}

/**
 * Registra o resultado da avaliação de uma lição.
 * A lição só é concluída (e o vocabulário só entra nas revisões) se a nota atingir o mínimo.
 */
export async function recordAssessment(db: Db, lang: LangCode, lesson: LessonContent, score: SessionScore): Promise<{ firstCompletion: boolean }> {
  const now = new Date();
  let firstCompletion = false;
  await db.tx(async () => {
    await db.run(
      'INSERT INTO assessments (lang, lesson_id, score, total, passed, skills_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [lang, lesson.id, score.correct, score.total, score.passed ? 1 : 0, JSON.stringify(score.bySkill), now.toISOString()]
    );
    const prev = await db.first<{ status: string; best_score: number }>('SELECT status, best_score FROM lesson_progress WHERE lesson_id = ?', [lesson.id]);
    const best = Math.max(prev?.best_score ?? 0, score.ratio);
    const completed = prev?.status === 'completed' || score.passed;
    firstCompletion = score.passed && prev?.status !== 'completed';
    await db.run(
      `INSERT INTO lesson_progress (lesson_id, lang, status, best_score, attempts, started_at, completed_at, last_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(lesson_id) DO UPDATE SET status = excluded.status, best_score = excluded.best_score, attempts = attempts + 1,
         completed_at = COALESCE(lesson_progress.completed_at, excluded.completed_at), last_at = excluded.last_at`,
      [lesson.id, lang, completed ? 'completed' : 'started', best, now.toISOString(), score.passed ? now.toISOString() : null, now.toISOString()]
    );
    if (score.passed) {
      for (const item of [...lesson.words, ...lesson.sentences]) await learnItem(db, lang, lesson.id, item, now);
    }
    if (firstCompletion) await addXp(db, lang, XP.lessonCompleted, 'lesson');
  });
  return { firstCompletion };
}

// ---------- Nível e progresso ----------

export interface LangSummary {
  lang: LangCode;
  /** Nível em estudo: o da próxima lição não concluída. Não é certificação. */
  level: Level;
  /** Fração de lições concluídas dentro do nível em estudo (0–1). */
  levelProgress: number;
  lessonsCompleted: number;
  lessonsTotal: number;
  wordsLearned: number;
  nextLesson: LessonRow | null;
  /** Todo o conteúdo disponível foi concluído. */
  finishedAvailable: boolean;
  started: boolean;
}

export async function getLangSummary(db: Db, lang: LangCode): Promise<LangSummary> {
  const lessons = flattenLessons(await getCourseTree(db, lang));
  const done = lessons.filter((l) => l.status === 'completed');
  const next = lessons.find((l) => l.status !== 'completed') ?? null;
  const lastLevel = lessons.length ? lessons[lessons.length - 1].level : 'A1';
  const level = next?.level ?? lastLevel;
  const inLevel = lessons.filter((l) => l.level === level);
  const words = (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM vocabulary WHERE lang = ?', [lang]))?.n ?? 0;
  return {
    lang,
    level,
    levelProgress: inLevel.length ? inLevel.filter((l) => l.status === 'completed').length / inLevel.length : 0,
    lessonsCompleted: done.length,
    lessonsTotal: lessons.length,
    wordsLearned: words,
    nextLesson: next,
    finishedAvailable: lessons.length > 0 && !next,
    started: lessons.some((l) => l.status !== null),
  };
}

/** Uma lição está liberada se for a primeira ou se a anterior já foi concluída. Concluídas ficam sempre abertas. */
export function isUnlocked(lessons: LessonRow[], id: string): boolean {
  const i = lessons.findIndex((l) => l.id === id);
  if (i <= 0) return i === 0;
  return lessons[i].status !== null || lessons[i - 1].status === 'completed';
}

export const levelIndex = (l: Level) => LEVELS.indexOf(l);

// ---------- Revisão espaçada ----------

export interface DueCard extends ReviewRow {
  term: string;
  reading: string | null;
  translation: string;
  kind: 'word' | 'phrase';
  lesson_id: string | null;
}

export async function countDue(db: Db, lang: LangCode, now = new Date()): Promise<number> {
  return (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM reviews WHERE lang = ? AND due <= ?', [lang, now.toISOString()]))?.n ?? 0;
}

/** Cartões vencidos, do mais atrasado para o menos: são os mais próximos de serem esquecidos. */
export async function getDueCards(db: Db, lang: LangCode, limit = 30, now = new Date()): Promise<DueCard[]> {
  return db.all<DueCard>(
    `SELECT r.*, v.term, v.reading, v.translation, v.kind, v.lesson_id FROM reviews r JOIN vocabulary v ON v.item_id = r.item_id
     WHERE r.lang = ? AND r.due <= ? ORDER BY r.due ASC LIMIT ?`,
    [lang, now.toISOString(), limit]
  );
}

export async function rateCard(db: Db, card: ReviewRow, rating: Grade, now = new Date()): Promise<ReviewRow> {
  const next = applyRating(card, rating, now);
  await db.tx(async () => {
    await saveReview(db, next);
    await db.run('INSERT INTO review_log (item_id, lang, rating, state_before, day, reviewed_at) VALUES (?, ?, ?, ?, ?, ?)', [card.item_id, card.lang, rating, card.state, todayKey(now), now.toISOString()]);
    await db.run('UPDATE vocabulary SET correct_count = correct_count + ?, wrong_count = wrong_count + ? WHERE item_id = ?', [rating === Rating.Again ? 0 : 1, rating === Rating.Again ? 1 : 0, card.item_id]);
    await addXp(db, card.lang as LangCode, XP.reviewCard, 'review');
  });
  return next;
}

export interface ReviewOverview {
  due: number;
  total: number;
  /** Itens com revisão marcada para os próximos 7 dias (sem contar os já vencidos). */
  upcoming7: number;
  /** % de revisões lembradas (≠ "Errei") nos últimos 30 dias; null sem dados. Medida objetiva. */
  retention30: number | null;
  reviews30: number;
}

export async function getReviewOverview(db: Db, lang: LangCode, now = new Date()): Promise<ReviewOverview> {
  const iso = now.toISOString();
  const week = new Date(now.getTime() + 7 * 86400000).toISOString();
  const month = todayKey(new Date(now.getTime() - 30 * 86400000));
  const c = await db.first<{ due: number; total: number; upcoming: number }>(
    `SELECT SUM(CASE WHEN due <= ? THEN 1 ELSE 0 END) AS due, COUNT(*) AS total,
            SUM(CASE WHEN due > ? AND due <= ? THEN 1 ELSE 0 END) AS upcoming FROM reviews WHERE lang = ?`,
    [iso, iso, week, lang]
  );
  const r = await db.first<{ n: number; ok: number }>(
    // Só conta cartões que já tinham sido aprendidos (state > 0): o primeiro contato não mede retenção.
    'SELECT COUNT(*) AS n, SUM(CASE WHEN rating > 1 THEN 1 ELSE 0 END) AS ok FROM review_log WHERE lang = ? AND day >= ? AND state_before > 0',
    [lang, month]
  );
  return {
    due: c?.due ?? 0,
    total: c?.total ?? 0,
    upcoming7: c?.upcoming ?? 0,
    retention30: r && r.n > 0 ? (r.ok ?? 0) / r.n : null,
    reviews30: r?.n ?? 0,
  };
}

/** Itens em que o aluno mais erra (para a seção de dificuldades). */
export async function getHardItems(db: Db, lang: LangCode, limit = 8) {
  return db.all<{ item_id: string; term: string; reading: string | null; translation: string; wrong_count: number; correct_count: number }>(
    `SELECT item_id, term, reading, translation, wrong_count, correct_count FROM vocabulary
     WHERE lang = ? AND wrong_count > 0 ORDER BY (wrong_count * 1.0 / (wrong_count + correct_count)) DESC, wrong_count DESC LIMIT ?`,
    [lang, limit]
  );
}
