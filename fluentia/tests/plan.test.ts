import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, currentStreak, levelFromXp, longestStreak } from '../src/domain/gamification';
import { balancedWeek, buildDailyPlan, type PlanLangInput } from '../src/domain/plan';

const lang = (code: PlanLangInput['lang'], patch: Partial<PlanLangInput> = {}): PlanLangInput => ({
  lang: code,
  active: true,
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  priority: 1,
  dueReviews: 0,
  nextLesson: { id: `${code}.a1.u1.l1`, title: 'Lição' },
  weakestSkill: null,
  minutesToday: 0,
  ...patch,
});

describe('plano de estudos', () => {
  it('só inclui os idiomas agendados para o dia da semana', () => {
    const plan = buildDailyPlan([lang('en', { weekdays: [1, 3] }), lang('ko', { weekdays: [2] }), lang('zh', { active: false })], 30, 1);
    expect(plan.langs.map((l) => l.lang)).toEqual(['en']);
    expect(plan.tasks.every((t) => t.lang === 'en')).toBe(true);
  });
  it('divide o tempo pela prioridade', () => {
    const plan = buildDailyPlan([lang('en', { priority: 2 }), lang('es', { priority: 1 })], 60, 0);
    expect(plan.langs).toEqual([
      { lang: 'en', minutes: 40, done: 0 },
      { lang: 'es', minutes: 20, done: 0 },
    ]);
  });
  it('revisões vencidas vêm antes da lição nova, sem ocupar todo o tempo', () => {
    const plan = buildDailyPlan([lang('en', { dueReviews: 200 })], 30, 0);
    expect(plan.tasks.map((t) => t.kind).slice(0, 2)).toEqual(['review', 'lesson']);
    expect(plan.tasks[0].minutes).toBeLessThanOrEqual(18);
  });
  it('reforça a habilidade fraca quando o acerto está baixo', () => {
    const plan = buildDailyPlan([lang('en', { weakestSkill: { skill: 'Escuta', accuracy: 0.5 } })], 45, 0);
    expect(plan.tasks.some((t) => t.kind === 'skill' && t.title.includes('Escuta'))).toBe(true);
    const ok = buildDailyPlan([lang('en', { weakestSkill: { skill: 'Escuta', accuracy: 0.9 } })], 45, 0);
    expect(ok.tasks.some((t) => t.kind === 'skill')).toBe(false);
  });
  it('em dia livre só sugere revisões vencidas', () => {
    const plan = buildDailyPlan([lang('en', { weekdays: [1], dueReviews: 12 }), lang('es', { weekdays: [1] })], 30, 0);
    expect(plan.tasks.map((t) => [t.kind, t.lang])).toEqual([['review', 'en']]);
    expect(plan.reason).toMatch(/dia livre/);
  });
  it('distribuição equilibrada alterna os idiomas na semana', () => {
    const w = balancedWeek(['en', 'es', 'ko', 'zh'], 2);
    expect(Object.values(w).flat().length).toBe(14);
    for (const days of Object.values(w)) expect(days.length).toBeGreaterThanOrEqual(3);
    for (let d = 0; d < 7; d++) expect(Object.values(w).filter((x) => x.includes(d)).length).toBe(2);
  });
});

describe('gamificação', () => {
  it('sequência conta dias seguidos até hoje ou ontem', () => {
    expect(currentStreak(['2026-03-01', '2026-03-02', '2026-03-03'], '2026-03-03')).toBe(3);
    expect(currentStreak(['2026-03-01', '2026-03-02'], '2026-03-03')).toBe(2);
    expect(currentStreak(['2026-03-01'], '2026-03-03')).toBe(0);
    expect(currentStreak([], '2026-03-03')).toBe(0);
    expect(currentStreak(['2026-02-28', '2026-03-01'], '2026-03-01')).toBe(2);
  });
  it('maior sequência', () => {
    expect(longestStreak(['2026-01-01', '2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07'])).toBe(3);
  });
  it('nível de XP cresce progressivamente', () => {
    expect(levelFromXp(0)).toEqual({ level: 1, into: 0, span: 100 });
    expect(levelFromXp(100).level).toBe(2);
    expect(levelFromXp(299)).toEqual({ level: 2, into: 199, span: 200 });
    expect(levelFromXp(300).level).toBe(3);
  });
  it('conquistas têm identificadores únicos', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
});
