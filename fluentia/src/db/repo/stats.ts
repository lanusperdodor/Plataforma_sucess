import { LANG_CODES, type LangCode } from '@/content';
import { SKILLS, type Skill } from '@/domain/exercises';
import { currentStreak, longestStreak, newlyUnlocked, type Achievement, type AchievementStats } from '@/domain/gamification';
import { addDays, todayKey } from '@/domain/text';
import type { Db } from '../types';
import { nowIso } from './core';

export async function getStudyDays(db: Db): Promise<string[]> {
  // Um dia conta como estudado se teve resposta, revisão ou tempo de estudo registrado.
  const rows = await db.all<{ day: string }>(
    `SELECT day FROM attempts UNION SELECT day FROM review_log UNION SELECT day FROM study_sessions WHERE seconds >= 30`
  );
  return rows.map((r) => r.day).sort();
}

export async function secondsOn(db: Db, day: string, lang?: LangCode): Promise<number> {
  const row = lang
    ? await db.first<{ s: number }>('SELECT COALESCE(SUM(seconds), 0) AS s FROM study_sessions WHERE day = ? AND lang = ?', [day, lang])
    : await db.first<{ s: number }>('SELECT COALESCE(SUM(seconds), 0) AS s FROM study_sessions WHERE day = ?', [day]);
  return row?.s ?? 0;
}

export async function totalXp(db: Db): Promise<number> {
  return (await db.first<{ x: number }>('SELECT COALESCE(SUM(amount), 0) AS x FROM xp_log'))?.x ?? 0;
}

export interface SkillStat {
  skill: Skill;
  total: number;
  correct: number;
  accuracy: number | null;
}

/** Acertos por habilidade em uma janela de dias. Medida objetiva (respostas corrigidas). */
export async function getSkillStats(db: Db, lang: LangCode, days = 30): Promise<SkillStat[]> {
  const since = addDays(todayKey(), -days);
  const rows = await db.all<{ skill: Skill; total: number; correct: number }>(
    `SELECT skill, COUNT(*) AS total, SUM(correct) AS correct FROM attempts
     WHERE lang = ? AND day >= ? AND correct IS NOT NULL GROUP BY skill`,
    [lang, since]
  );
  return SKILLS.map((skill) => {
    const r = rows.find((x) => x.skill === skill);
    return { skill, total: r?.total ?? 0, correct: r?.correct ?? 0, accuracy: r && r.total ? (r.correct ?? 0) / r.total : null };
  });
}

/** Habilidade com pior acerto recente, exigindo um mínimo de respostas para não reagir a ruído. */
export async function getWeakestSkill(db: Db, lang: LangCode): Promise<SkillStat | null> {
  const stats = (await getSkillStats(db, lang, 14)).filter((s) => s.total >= 8 && s.accuracy !== null);
  if (!stats.length) return null;
  return stats.reduce((a, b) => (a.accuracy! <= b.accuracy! ? a : b));
}

export interface DayPoint {
  day: string;
  seconds: number;
  total: number;
  correct: number;
}

export async function getDailySeries(db: Db, days: number, lang?: LangCode): Promise<DayPoint[]> {
  const today = todayKey();
  const since = addDays(today, -(days - 1));
  const where = lang ? 'AND lang = ?' : '';
  const params = lang ? [since, lang] : [since];
  const time = await db.all<{ day: string; s: number }>(`SELECT day, SUM(seconds) AS s FROM study_sessions WHERE day >= ? ${where} GROUP BY day`, params);
  const acc = await db.all<{ day: string; total: number; correct: number }>(
    `SELECT day, COUNT(*) AS total, SUM(correct) AS correct FROM attempts WHERE day >= ? AND correct IS NOT NULL ${where} GROUP BY day`,
    params
  );
  const out: DayPoint[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(since, i);
    const a = acc.find((x) => x.day === day);
    out.push({ day, seconds: time.find((x) => x.day === day)?.s ?? 0, total: a?.total ?? 0, correct: a?.correct ?? 0 });
  }
  return out;
}

/** Acerto por habilidade semana a semana (últimas `weeks` semanas), para ver evolução. */
export async function getSkillTrend(db: Db, lang: LangCode, skill: Skill, weeks = 8): Promise<{ label: string; accuracy: number | null; total: number }[]> {
  const today = todayKey();
  const out: { label: string; accuracy: number | null; total: number }[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const end = addDays(today, -7 * w);
    const start = addDays(end, -6);
    const r = await db.first<{ total: number; correct: number }>(
      'SELECT COUNT(*) AS total, SUM(correct) AS correct FROM attempts WHERE lang = ? AND skill = ? AND correct IS NOT NULL AND day BETWEEN ? AND ?',
      [lang, skill, start, end]
    );
    out.push({ label: start.slice(8) + '/' + start.slice(5, 7), accuracy: r && r.total ? (r.correct ?? 0) / r.total : null, total: r?.total ?? 0 });
  }
  return out;
}

export interface Totals {
  seconds: number;
  secondsByLang: Record<LangCode, number>;
  attempts: number;
  correct: number;
  wrong: number;
  words: number;
  lessons: number;
  reviews: number;
  conversationTurns: number;
  writing: number;
  xp: number;
  streak: number;
  longestStreak: number;
  studyDays: string[];
}

export async function getTotals(db: Db): Promise<Totals> {
  const n = async (sql: string, p: (string | number)[] = []) => (await db.first<{ n: number }>(sql, p))?.n ?? 0;
  const byLang = await db.all<{ lang: LangCode; s: number }>('SELECT lang, SUM(seconds) AS s FROM study_sessions GROUP BY lang');
  const secondsByLang = Object.fromEntries(LANG_CODES.map((l) => [l, byLang.find((x) => x.lang === l)?.s ?? 0])) as Record<LangCode, number>;
  const studyDays = await getStudyDays(db);
  const correct = await n('SELECT COUNT(*) AS n FROM attempts WHERE correct = 1');
  const wrong = await n('SELECT COUNT(*) AS n FROM attempts WHERE correct = 0');
  return {
    seconds: Object.values(secondsByLang).reduce((a, b) => a + b, 0),
    secondsByLang,
    attempts: correct + wrong,
    correct,
    wrong,
    words: await n('SELECT COUNT(*) AS n FROM vocabulary'),
    lessons: await n("SELECT COUNT(*) AS n FROM lesson_progress WHERE status = 'completed'"),
    reviews: await n('SELECT COUNT(*) AS n FROM review_log'),
    conversationTurns: await n("SELECT COUNT(*) AS n FROM messages WHERE role = 'user'"),
    writing: await n('SELECT COUNT(*) AS n FROM writing_submissions'),
    xp: await totalXp(db),
    streak: currentStreak(studyDays, todayKey()),
    longestStreak: longestStreak(studyDays),
    studyDays,
  };
}

export async function getGoals(db: Db): Promise<Record<string, number>> {
  const rows = await db.all<{ kind: string; target: number }>('SELECT kind, target FROM goals');
  return Object.fromEntries(rows.map((r) => [r.kind, r.target]));
}

export async function setGoal(db: Db, kind: string, target: number): Promise<void> {
  await db.run('INSERT INTO goals (kind, target) VALUES (?, ?) ON CONFLICT(kind) DO UPDATE SET target = excluded.target', [kind, Math.max(1, Math.round(target))]);
}

/** Progresso das metas da semana corrente (segunda a domingo). */
export async function getWeekProgress(db: Db): Promise<{ lessons: number; reviews: number; start: string }> {
  const now = new Date();
  const start = addDays(todayKey(now), -((now.getDay() + 6) % 7));
  const lessons = (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM lesson_progress WHERE status = 'completed' AND substr(completed_at, 1, 10) >= ?", [start]))?.n ?? 0;
  const reviews = (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM review_log WHERE day >= ?', [start]))?.n ?? 0;
  return { lessons, reviews, start };
}

export async function getUnlockedAchievements(db: Db): Promise<{ id: string; unlocked_at: string }[]> {
  return db.all('SELECT id, unlocked_at FROM achievements');
}

/** Verifica conquistas com base em dados reais e grava as novas. Devolve as recém-desbloqueadas. */
export async function checkAchievements(db: Db): Promise<Achievement[]> {
  const t = await getTotals(db);
  const n = async (sql: string) => (await db.first<{ n: number }>(sql))?.n ?? 0;
  const stats: AchievementStats = {
    lessonsCompleted: t.lessons,
    wordsLearned: t.words,
    streak: t.streak,
    longestStreak: t.longestStreak,
    reviewsDone: t.reviews,
    conversationTurns: t.conversationTurns,
    speakingCorrect: await n("SELECT COUNT(*) AS n FROM attempts WHERE skill = 'speaking' AND correct = 1"),
    totalMinutes: Math.floor(t.seconds / 60),
    languagesStarted: await n('SELECT COUNT(*) AS n FROM languages WHERE started_at IS NOT NULL'),
    perfectAssessments: await n('SELECT COUNT(*) AS n FROM assessments WHERE score = total AND total > 0'),
    writingSubmissions: t.writing,
  };
  const have = (await getUnlockedAchievements(db)).map((a) => a.id);
  const fresh = newlyUnlocked(stats, have);
  for (const a of fresh) await db.run('INSERT OR IGNORE INTO achievements (id, unlocked_at) VALUES (?, ?)', [a.id, nowIso()]);
  return fresh;
}
