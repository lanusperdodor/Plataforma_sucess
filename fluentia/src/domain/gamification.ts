import { addDays } from './text';

export const XP = {
  exerciseCorrect: 10,
  exerciseTried: 2,
  reviewCard: 5,
  lessonCompleted: 50,
  conversationTurn: 8,
  writingSubmitted: 20,
} as const;

/** Sequência atual: dias seguidos com estudo, terminando hoje ou ontem (hoje ainda pode ser cumprido). */
export function currentStreak(studyDays: string[], today: string): number {
  const set = new Set(studyDays);
  let cursor = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(cursor)) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

export function longestStreak(studyDays: string[]): number {
  const days = [...new Set(studyDays)].sort();
  let best = 0;
  let run = 0;
  let prev = '';
  for (const d of days) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

export function levelFromXp(xp: number): { level: number; into: number; span: number } {
  // Cada nível de XP pede 100 a mais que o anterior: 100, 200, 300…
  let level = 1;
  let rest = xp;
  while (rest >= level * 100) {
    rest -= level * 100;
    level++;
  }
  return { level, into: rest, span: level * 100 };
}

export interface AchievementStats {
  lessonsCompleted: number;
  wordsLearned: number;
  streak: number;
  longestStreak: number;
  reviewsDone: number;
  conversationTurns: number;
  speakingCorrect: number;
  totalMinutes: number;
  languagesStarted: number;
  perfectAssessments: number;
  writingSubmissions: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  test: (s: AchievementStats) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-lesson', title: 'Primeiro passo', description: 'Conclua sua primeira lição.', icon: 'flag', test: (s) => s.lessonsCompleted >= 1 },
  { id: 'lessons-10', title: 'Ritmo de estudo', description: 'Conclua 10 lições.', icon: 'school', test: (s) => s.lessonsCompleted >= 10 },
  { id: 'lessons-30', title: 'Dedicação', description: 'Conclua 30 lições.', icon: 'ribbon', test: (s) => s.lessonsCompleted >= 30 },
  { id: 'words-50', title: '50 palavras', description: 'Aprenda 50 palavras ou frases.', icon: 'book', test: (s) => s.wordsLearned >= 50 },
  { id: 'words-200', title: '200 palavras', description: 'Aprenda 200 palavras ou frases.', icon: 'library', test: (s) => s.wordsLearned >= 200 },
  { id: 'streak-3', title: 'Três em sequência', description: 'Estude 3 dias seguidos.', icon: 'flame', test: (s) => s.longestStreak >= 3 },
  { id: 'streak-7', title: 'Uma semana inteira', description: 'Estude 7 dias seguidos.', icon: 'flame', test: (s) => s.longestStreak >= 7 },
  { id: 'streak-30', title: 'Hábito formado', description: 'Estude 30 dias seguidos.', icon: 'bonfire', test: (s) => s.longestStreak >= 30 },
  { id: 'reviews-100', title: 'Memória em dia', description: 'Faça 100 revisões.', icon: 'refresh-circle', test: (s) => s.reviewsDone >= 100 },
  { id: 'talk-20', title: 'Soltando a língua', description: 'Troque 20 mensagens com o professor.', icon: 'chatbubbles', test: (s) => s.conversationTurns >= 20 },
  { id: 'speak-25', title: 'Voz ativa', description: 'Tenha 25 frases reconhecidas na prática de fala.', icon: 'mic', test: (s) => s.speakingCorrect >= 25 },
  { id: 'perfect', title: 'Sem erros', description: 'Tire 100% em uma avaliação.', icon: 'star', test: (s) => s.perfectAssessments >= 1 },
  { id: 'polyglot', title: 'Poliglota em formação', description: 'Comece os quatro idiomas.', icon: 'earth', test: (s) => s.languagesStarted >= 4 },
  { id: 'hours-10', title: '10 horas', description: 'Acumule 10 horas de estudo.', icon: 'time', test: (s) => s.totalMinutes >= 600 },
  { id: 'writer', title: 'Escritor', description: 'Envie 10 textos para correção.', icon: 'create', test: (s) => s.writingSubmissions >= 10 },
];

export function newlyUnlocked(stats: AchievementStats, already: string[]): Achievement[] {
  const have = new Set(already);
  return ACHIEVEMENTS.filter((a) => !have.has(a.id) && a.test(stats));
}
