import { LANG_CODES, type LangCode } from '@/content';
import { countDue, getLangSummary, getLanguages, getProfile, getWeakestSkill, secondsOn, type LangSummary } from '@/db/repo';
import type { Db } from '@/db/types';
import { SKILL_NAMES } from '@/domain/exercises';
import { buildDailyPlan, type DailyPlan } from '@/domain/plan';
import { todayKey } from '@/domain/text';

export interface PlanData {
  plan: DailyPlan;
  summaries: Record<LangCode, LangSummary>;
  due: Record<LangCode, number>;
  secondsToday: number;
  dailyMinutes: number;
}

/** Junta progresso, revisões vencidas e desempenho recente para montar o plano de hoje. */
export async function loadPlan(db: Db): Promise<PlanData> {
  const [profile, langs] = await Promise.all([getProfile(db), getLanguages(db)]);
  const today = todayKey();
  const summaries = {} as Record<LangCode, LangSummary>;
  const due = {} as Record<LangCode, number>;
  const inputs = [];
  for (const code of LANG_CODES) {
    const row = langs.find((l) => l.code === code)!;
    const summary = await getLangSummary(db, code);
    const weakest = await getWeakestSkill(db, code);
    summaries[code] = summary;
    due[code] = await countDue(db, code);
    inputs.push({
      lang: code,
      active: row.active === 1,
      weekdays: JSON.parse(row.weekdays) as number[],
      priority: row.priority,
      dueReviews: due[code],
      nextLesson: summary.nextLesson ? { id: summary.nextLesson.id, title: summary.nextLesson.title } : null,
      weakestSkill: weakest ? { skill: SKILL_NAMES[weakest.skill], accuracy: weakest.accuracy! } : null,
      minutesToday: Math.round((await secondsOn(db, today, code)) / 60),
    });
  }
  return {
    plan: buildDailyPlan(inputs, profile.daily_minutes, new Date().getDay()),
    summaries,
    due,
    secondsToday: await secondsOn(db, today),
    dailyMinutes: profile.daily_minutes,
  };
}

export function formatMinutes(seconds: number): string {
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
