import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs';

/**
 * Repetição espaçada com FSRS (Free Spaced Repetition Scheduler), via biblioteca ts-fsrs.
 * Retenção desejada de 90%: cada cartão volta quando a chance estimada de lembrar cai para ~90%.
 */
const scheduler = fsrs(generatorParameters({ request_retention: 0.9, enable_fuzz: false, maximum_interval: 365 }));

export { Rating, State };
export type { Grade };

export interface ReviewRow {
  item_id: string;
  lang: string;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
}

export function newReviewRow(itemId: string, lang: string, now: Date): ReviewRow {
  return toRow(itemId, lang, createEmptyCard(now));
}

function toCard(r: ReviewRow): Card {
  return {
    due: new Date(r.due),
    stability: r.stability,
    difficulty: r.difficulty,
    elapsed_days: r.elapsed_days,
    scheduled_days: r.scheduled_days,
    learning_steps: r.learning_steps,
    reps: r.reps,
    lapses: r.lapses,
    state: r.state as State,
    last_review: r.last_review ? new Date(r.last_review) : undefined,
  };
}

function toRow(itemId: string, lang: string, c: Card): ReviewRow {
  return {
    item_id: itemId,
    lang,
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ? c.last_review.toISOString() : null,
  };
}

/** Aplica uma avaliação (Errei / Difícil / Bom / Fácil) e devolve o cartão reagendado. */
export function applyRating(row: ReviewRow, rating: Grade, now: Date): ReviewRow {
  const { card } = scheduler.next(toCard(row), now, rating);
  return toRow(row.item_id, row.lang, card);
}

/** Probabilidade estimada (0–1) de lembrar o item agora. Estimativa do modelo, não medição. */
export function retrievability(row: ReviewRow, now: Date): number {
  if (row.state === State.New) return 0;
  return scheduler.get_retrievability(toCard(row), now, false);
}

/** Texto do próximo intervalo para cada botão, ex.: "10 min", "3 d". */
export function previewIntervals(row: ReviewRow, now: Date): Record<Grade, string> {
  const rec = scheduler.repeat(toCard(row), now);
  const fmt = (due: Date) => {
    const min = Math.max(1, Math.round((due.getTime() - now.getTime()) / 60000));
    if (min < 60) return `${min} min`;
    if (min < 60 * 24) return `${Math.round(min / 60)} h`;
    const d = Math.round(min / 1440);
    return d < 30 ? `${d} d` : `${Math.round(d / 30)} m`;
  };
  return {
    [Rating.Again]: fmt(rec[Rating.Again].card.due),
    [Rating.Hard]: fmt(rec[Rating.Hard].card.due),
    [Rating.Good]: fmt(rec[Rating.Good].card.due),
    [Rating.Easy]: fmt(rec[Rating.Easy].card.due),
  } as Record<Grade, string>;
}
