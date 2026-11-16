import type { CourseContent, Item, LangCode, LessonContent, Level, PlannedUnit, ToneDrill, UnitContent } from './types';

type Extra = { alt?: string[]; ptAlt?: string[] };
export type Raw = [t: string, pt: string, r?: string | null, extra?: Extra];

export interface LessonDef {
  title: string;
  objective: string;
  explanation: string[];
  pronunciation?: string[];
  words: Raw[];
  sentences: Raw[];
  tones?: ToneDrill[];
  reading?: LessonContent['reading'];
  scenario: string;
  script?: boolean;
}

/**
 * Os identificadores (idioma.nível.unidade.lição.item) guardam o progresso do aluno.
 * Nunca reordene palavras/frases de uma lição publicada: acrescente sempre no fim.
 */
function items(lessonId: string, prefix: 'w' | 's', raws: Raw[]): Item[] {
  return raws.map(([t, pt, r, extra], i) => ({
    id: `${lessonId}.${prefix}${i + 1}`,
    kind: prefix === 'w' ? 'word' : 'phrase',
    t,
    pt,
    ...(r ? { r } : {}),
    ...(extra ?? {}),
  }));
}

export function course(
  lang: LangCode,
  level: Level,
  title: string,
  units: { title: string; description: string; lessons: LessonDef[] }[],
  planned: PlannedUnit[]
): CourseContent {
  const lv = level.toLowerCase();
  const built: UnitContent[] = units.map((u, ui) => ({
    id: `${lang}.${lv}.u${ui + 1}`,
    title: u.title,
    description: u.description,
    lessons: u.lessons.map((l, li) => {
      const id = `${lang}.${lv}.u${ui + 1}.l${li + 1}`;
      return {
        id,
        title: l.title,
        objective: l.objective,
        explanation: l.explanation,
        pronunciation: l.pronunciation,
        words: items(id, 'w', l.words),
        sentences: items(id, 's', l.sentences),
        tones: l.tones,
        reading: l.reading ?? (lang === 'ko' || lang === 'zh' ? 'always' : 'never'),
        scenario: l.scenario,
        script: l.script,
      };
    }),
  }));
  return { lang, level, title, units: built, planned };
}
