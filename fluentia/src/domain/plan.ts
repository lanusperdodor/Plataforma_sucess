import type { LangCode } from '@/content/types';

export interface PlanLangInput {
  lang: LangCode;
  active: boolean;
  /** Dias da semana em que o idioma é estudado (0 = domingo). */
  weekdays: number[];
  /** Peso relativo do idioma na divisão do tempo (1–3). */
  priority: number;
  dueReviews: number;
  /** Próxima lição ainda não concluída, se houver. */
  nextLesson: { id: string; title: string } | null;
  /** Taxa de acerto recente por habilidade (0–1), quando há dados suficientes. */
  weakestSkill: { skill: string; accuracy: number } | null;
  minutesToday: number;
}

export interface PlanTask {
  kind: 'review' | 'lesson' | 'skill' | 'conversation';
  lang: LangCode;
  title: string;
  detail: string;
  minutes: number;
  lessonId?: string;
  skill?: string;
}

export interface DailyPlan {
  totalMinutes: number;
  langs: { lang: LangCode; minutes: number; done: number }[];
  tasks: PlanTask[];
  /** Explicação de por que o plano ficou assim. */
  reason: string;
}

const REVIEW_SECONDS = 12; // média por cartão
const LESSON_MINUTES = 12;

/**
 * Plano do dia. Não exige todos os idiomas todos os dias: usa só os agendados para o dia da semana.
 * Ordem de prioridade dentro de cada idioma: revisões vencidas → próxima lição → habilidade mais fraca → conversa.
 */
export function buildDailyPlan(inputs: PlanLangInput[], dailyMinutes: number, weekday: number): DailyPlan {
  let todays = inputs.filter((l) => l.active && l.weekdays.includes(weekday));
  let reason = '';
  if (!todays.length) {
    // Dia sem idioma agendado: só sugere revisões vencidas, se existirem, para não perder retenção.
    todays = inputs.filter((l) => l.active && l.dueReviews > 0);
    reason = todays.length
      ? 'Hoje é dia livre no seu plano. Há revisões vencendo — uma passada rápida ajuda a não esquecer.'
      : 'Hoje é dia livre no seu plano. Descanse ou estude o que quiser.';
    const tasks = todays.map<PlanTask>((l) => ({
      kind: 'review',
      lang: l.lang,
      title: 'Revisar hoje',
      detail: `${l.dueReviews} ${l.dueReviews === 1 ? 'item' : 'itens'} para revisar`,
      minutes: Math.max(1, Math.ceil((l.dueReviews * REVIEW_SECONDS) / 60)),
    }));
    return { totalMinutes: dailyMinutes, langs: [], tasks, reason };
  }

  const weight = todays.reduce((a, l) => a + l.priority, 0);
  const langs = todays.map((l) => ({
    lang: l.lang,
    minutes: Math.max(5, Math.round((dailyMinutes * l.priority) / weight)),
    done: l.minutesToday,
  }));

  const tasks: PlanTask[] = [];
  for (const l of todays) {
    let budget = langs.find((x) => x.lang === l.lang)!.minutes;
    if (l.dueReviews > 0) {
      const all = Math.ceil((l.dueReviews * REVIEW_SECONDS) / 60);
      // Revisões podem tomar no máximo 60% do tempo do idioma, para sempre sobrar conteúdo novo.
      const minutes = Math.max(1, Math.min(all, Math.ceil(budget * 0.6)));
      tasks.push({
        kind: 'review',
        lang: l.lang,
        title: 'Revisar hoje',
        detail: `${l.dueReviews} ${l.dueReviews === 1 ? 'item' : 'itens'} para revisar`,
        minutes,
      });
      budget -= minutes;
    }
    if (l.nextLesson && budget >= 5) {
      tasks.push({
        kind: 'lesson',
        lang: l.lang,
        title: l.nextLesson.title,
        detail: 'Próxima lição',
        minutes: Math.min(LESSON_MINUTES, budget),
        lessonId: l.nextLesson.id,
      });
      budget -= LESSON_MINUTES;
    }
    if (l.weakestSkill && l.weakestSkill.accuracy < 0.75 && budget >= 4) {
      tasks.push({
        kind: 'skill',
        lang: l.lang,
        title: `Reforço: ${l.weakestSkill.skill}`,
        detail: `Acerto recente de ${Math.round(l.weakestSkill.accuracy * 100)}%`,
        minutes: Math.min(8, budget),
        skill: l.weakestSkill.skill,
      });
      budget -= 8;
    }
    if (budget >= 5) {
      tasks.push({
        kind: 'conversation',
        lang: l.lang,
        title: 'Conversar com o professor',
        detail: 'Praticar o que você já estudou',
        minutes: Math.min(10, budget),
      });
    }
  }
  reason =
    todays.length === 1
      ? 'Hoje o plano concentra o tempo em um idioma.'
      : `Hoje o tempo está dividido entre ${todays.length} idiomas, conforme a prioridade de cada um.`;
  return { totalMinutes: dailyMinutes, langs, tasks, reason };
}

/** Sugestão de distribuição semanal equilibrada: no máximo `perDay` idiomas por dia, alternando. */
export function balancedWeek(langs: LangCode[], perDay: number): Record<LangCode, number[]> {
  const out = Object.fromEntries(langs.map((l) => [l, [] as number[]])) as Record<LangCode, number[]>;
  if (!langs.length) return out;
  const n = Math.max(1, Math.min(perDay, langs.length));
  let k = 0;
  for (let day = 0; day < 7; day++) {
    for (let i = 0; i < n; i++) {
      out[langs[k % langs.length]].push(day);
      k++;
    }
  }
  return out;
}
