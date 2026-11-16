import { display, LANGS, type Item, type LangCode, type LessonContent } from '@/content/types';
import { compareSpeech, gradeText, type GradeResult, type SpeechComparison } from './grading';
import { hashSeed, rng, shuffle } from './text';

export type Skill = 'vocabulary' | 'reading' | 'writing' | 'listening' | 'speaking';
export const SKILLS: Skill[] = ['vocabulary', 'reading', 'writing', 'listening', 'speaking'];
export const SKILL_NAMES: Record<Skill, string> = {
  vocabulary: 'Vocabulário',
  reading: 'Leitura',
  writing: 'Escrita',
  listening: 'Escuta',
  speaking: 'Fala',
};

export type ExerciseType =
  | 'choose_pt' // lê no idioma → escolhe o significado
  | 'choose_target' // lê em português → escolhe no idioma
  | 'listen_choose' // ouve → escolhe o significado (ouvir e traduzir)
  | 'listen_pick' // ouve → identifica o que foi dito
  | 'order' // organiza as palavras
  | 'fill' // completa a frase
  | 'translate' // traduz digitando no idioma
  | 'translate_pt' // lê no idioma → escreve em português
  | 'dictation' // ouve → escreve o que ouviu
  | 'speak' // repete em voz alta
  | 'tone'; // identifica o tom (mandarim)

export interface Exercise {
  id: string;
  type: ExerciseType;
  skill: Skill;
  lang: LangCode;
  lessonId: string;
  itemId: string;
  instruction: string;
  /** Texto exibido como enunciado (pode ficar oculto nos exercícios de escuta). */
  prompt?: string;
  promptReading?: string;
  /** A leitura auxiliar começa oculta e aparece ao tocar (redução gradual da romanização). */
  readingHidden?: boolean;
  /** Texto no idioma estudado a ser falado pela síntese de voz. */
  audio?: string;
  options?: string[];
  bank?: string[];
  /** Respostas aceitas; a primeira é a forma principal. */
  accepted: string[];
  answerLang: LangCode | 'pt';
  /** Mostrados no feedback, depois da tentativa. */
  target: string;
  reading?: string;
  translation: string;
}

export const PASS_RATIO = 0.7;

const TONE_OPTIONS = ['1º tom (alto e plano) ¯', '2º tom (sobe) ´', '3º tom (desce e sobe) ˇ', '4º tom (desce) `', 'Tom neutro (leve)'];

function distractors(correct: string, pool: string[], n: number, rand: () => number): string[] {
  const uniq = [...new Set(pool)].filter((p) => p !== correct);
  return shuffle(uniq, rand).slice(0, n);
}

function withOptions(correct: string, pool: string[], rand: () => number): string[] | null {
  const d = distractors(correct, pool, 3, rand);
  if (d.length < 2) return null;
  return shuffle([correct, ...d], rand);
}

export interface BuildOptions {
  mode: 'practice' | 'assessment';
  /** Semente: muda a cada tentativa para variar ordem e alternativas. */
  seed: number;
  /** Itens de outras lições, usados só para completar alternativas erradas. */
  pool?: Item[];
  /** Se falso, os exercícios de fala são omitidos (reconhecimento indisponível). */
  speech: boolean;
}

/** Monta a sequência de exercícios de uma lição a partir do conteúdo dela. */
export function buildLessonExercises(lesson: LessonContent, lang: LangCode, opts: BuildOptions): Exercise[] {
  const rand = rng(hashSeed(lesson.id) ^ opts.seed);
  const assess = opts.mode === 'assessment';
  const typed = (lang === 'en' || lang === 'es') && !lesson.script;
  const showReading = !assess && lesson.reading !== 'never';
  const readingHidden = lesson.reading === 'tap';
  const all = [...lesson.words, ...lesson.sentences, ...(opts.pool ?? [])];
  const ptPool = all.map((i) => i.pt);
  const dsp = (t: string) => display(lang, t);
  const out: Exercise[] = [];
  let n = 0;

  const make = (type: ExerciseType, skill: Skill, item: Item, extra: Partial<Exercise>): Exercise => ({
    id: `${lesson.id}#${opts.mode}${n++}`,
    type,
    skill,
    lang,
    lessonId: lesson.id,
    itemId: item.id,
    instruction: '',
    accepted: [],
    answerLang: 'pt',
    target: dsp(item.t),
    reading: item.r,
    readingHidden,
    translation: item.pt,
    ...extra,
  });
  const targetsOf = (i: Item) => [i.t, ...(i.alt ?? [])].map(dsp);
  const ptsOf = (i: Item) => [i.pt, ...(i.ptAlt ?? [])];
  const sameKindTargets = (i: Item) => all.filter((x) => x.kind === i.kind).map((x) => dsp(x.t));

  const choosePt = (i: Item) => {
    const options = withOptions(i.pt, ptPool, rand);
    return options && make('choose_pt', lesson.script ? 'reading' : 'vocabulary', i, {
      instruction: lesson.script ? 'Que som é este?' : 'O que significa?',
      prompt: dsp(i.t),
      promptReading: showReading ? i.r : undefined,
      audio: assess ? undefined : dsp(i.t),
      options,
      accepted: [i.pt],
    });
  };
  const chooseTarget = (i: Item) => {
    const options = withOptions(dsp(i.t), sameKindTargets(i), rand);
    return options && make('choose_target', 'vocabulary', i, {
      instruction: lesson.script ? 'Qual é a letra/sílaba deste som?' : `Como se diz em ${LANGS[lang].name.toLowerCase()}?`,
      prompt: i.pt,
      options,
      accepted: [dsp(i.t)],
      answerLang: lang,
    });
  };
  const listenChoose = (i: Item) => {
    const options = withOptions(i.pt, ptPool, rand);
    return options && make('listen_choose', 'listening', i, {
      instruction: lesson.script ? 'Ouça. Que som é este?' : 'Ouça e escolha o significado',
      audio: dsp(i.t),
      options,
      accepted: [i.pt],
    });
  };
  const listenPick = (i: Item) => {
    const options = withOptions(dsp(i.t), sameKindTargets(i), rand);
    return options && make('listen_pick', 'listening', i, {
      instruction: 'Ouça e identifique o que foi dito',
      audio: dsp(i.t),
      options,
      accepted: [dsp(i.t)],
      answerLang: lang,
    });
  };
  const order = (i: Item) => {
    const words = i.t.split(' ');
    if (words.length < 3) return null;
    const extra = distractors('', all.flatMap((x) => x.t.split(' ')).filter((w) => !words.includes(w)), 2, rand);
    return make('order', 'writing', i, {
      instruction: 'Monte a frase',
      prompt: i.pt,
      bank: shuffle([...words, ...extra], rand),
      accepted: targetsOf(i),
      answerLang: lang,
    });
  };
  const fill = (i: Item) => {
    const words = i.t.split(' ');
    if (words.length < 3) return null;
    const vocab = new Set(lesson.words.flatMap((w) => w.t.split(' ')));
    const candidates = words.map((w, idx) => ({ w, idx })).filter((c) => c.w.replace(/[.,!?¿¡。？！，]/g, '').length > 0);
    const preferred = candidates.filter((c) => vocab.has(c.w.replace(/[.,!?¿¡。？！，]/g, '')));
    const pick = (preferred.length ? preferred : candidates)[Math.floor(rand() * (preferred.length || candidates.length))];
    const clean = pick.w.replace(/[.,!?¿¡。？！，]/g, '');
    const options = withOptions(clean, all.flatMap((x) => x.t.split(' ')).map((w) => w.replace(/[.,!?¿¡。？！，]/g, '')).filter(Boolean), rand);
    if (!options) return null;
    const blanked = words.map((w, idx) => (idx === pick.idx ? w.replace(clean, '____') : w)).join(' ');
    return make('fill', 'writing', i, {
      instruction: 'Complete a frase',
      prompt: lang === 'zh' ? blanked.replace(/ /g, '') : blanked,
      options,
      accepted: [clean],
      answerLang: lang,
    });
  };
  const translate = (i: Item) =>
    make('translate', 'writing', i, {
      instruction: `Escreva em ${LANGS[lang].name.toLowerCase()}`,
      prompt: i.pt,
      accepted: targetsOf(i),
      answerLang: lang,
    });
  const translatePt = (i: Item) =>
    make('translate_pt', 'reading', i, {
      instruction: 'Escreva em português',
      prompt: dsp(i.t),
      promptReading: showReading ? i.r : undefined,
      accepted: ptsOf(i),
    });
  const dictation = (i: Item) =>
    make('dictation', 'listening', i, {
      instruction: 'Ouça e escreva o que ouviu',
      audio: dsp(i.t),
      accepted: targetsOf(i),
      answerLang: lang,
    });
  const speak = (i: Item) =>
    make('speak', 'speaking', i, {
      instruction: 'Ouça e repita em voz alta',
      prompt: dsp(i.t),
      promptReading: showReading ? i.r : undefined,
      audio: dsp(i.t),
      accepted: targetsOf(i),
      answerLang: lang,
    });

  const push = (e: Exercise | null | false) => {
    if (e) out.push(e);
  };
  const words = shuffle(lesson.words, rand);
  const sentences = shuffle(lesson.sentences, rand);

  if (!assess) {
    // Prática: reconhecer → ouvir → produzir → falar, palavra por palavra e depois em frases.
    words.forEach((w, k) => push([choosePt, listenChoose, chooseTarget][k % 3](w)));
    words.slice(0, 4).forEach((w, k) => push(k % 2 ? listenPick(w) : chooseTarget(w)));
    sentences.forEach((s, k) => {
      push(k % 2 === 0 ? choosePt(s) : listenChoose(s));
      push(order(s) ?? chooseTarget(s));
      if (k % 3 === 0) push(fill(s));
      if (typed && k % 2 === 1) push(translate(s));
      if (typed && k % 2 === 0) push(dictation(s));
      if (opts.speech && k % 2 === 0) push(speak(s));
    });
  } else {
    // Avaliação: sem dicas de leitura nem áudio de apoio; cobre cada habilidade.
    words.slice(0, 3).forEach((w, k) => push(k % 2 === 0 ? chooseTarget(w) : choosePt(w)));
    words.slice(3, 5).forEach((w) => push(listenChoose(w)));
    const s = sentences;
    if (s[0]) push(typed ? translate(s[0]) : order(s[0]) ?? chooseTarget(s[0]));
    if (s[1]) push(typed ? dictation(s[1]) : listenPick(s[1]));
    if (s[2]) push(typed ? translatePt(s[2]) : choosePt(s[2]));
    if (s[3]) push(order(s[3]) ?? listenChoose(s[3]));
    if (s[4]) push(fill(s[4]) ?? listenChoose(s[4]));
    if (opts.speech && s.length) push(speak(s[5] ?? s[0]));
    if (!s.length) words.slice(5, 8).forEach((w) => push(listenPick(w)));
  }

  // Tons do mandarim: ouvir a sílaba e identificar o tom.
  if (lesson.tones?.length) {
    const drills = shuffle(lesson.tones, rand).slice(0, assess ? 3 : 6);
    for (const t of drills) {
      out.push({
        id: `${lesson.id}#${opts.mode}${n++}`,
        type: 'tone',
        skill: 'listening',
        lang,
        lessonId: lesson.id,
        itemId: `${lesson.id}.tone.${t.pinyin}`,
        instruction: 'Ouça e identifique o tom',
        audio: t.hanzi,
        options: TONE_OPTIONS,
        accepted: [TONE_OPTIONS[t.tone - 1]],
        answerLang: 'pt',
        target: `${t.hanzi} (${t.pinyin})`,
        reading: t.pinyin,
        translation: t.pt,
      });
    }
  }
  return out;
}

/** Treino livre de uma habilidade com itens já estudados. */
export function buildDrill(
  items: Item[],
  lang: LangCode,
  skill: 'listening' | 'speaking' | 'writing',
  seed: number,
  count = 10
): Exercise[] {
  const rand = rng(seed);
  const typed = lang === 'en' || lang === 'es';
  const fake: LessonContent = {
    id: `drill.${lang}.${skill}`,
    title: '',
    objective: '',
    explanation: [],
    words: items.filter((i) => i.kind === 'word'),
    sentences: items.filter((i) => i.kind === 'phrase'),
    reading: 'tap',
    scenario: '',
  };
  const full = buildLessonExercises(fake, lang, { mode: 'practice', seed, speech: skill === 'speaking' });
  const wanted: Record<typeof skill, ExerciseType[]> = {
    listening: typed ? ['dictation', 'listen_choose', 'listen_pick'] : ['listen_choose', 'listen_pick'],
    speaking: ['speak'],
    writing: typed ? ['translate', 'order', 'fill'] : ['order', 'fill', 'choose_target'],
  };
  let picked = full.filter((e) => wanted[skill].includes(e.type));
  if (skill === 'speaking') {
    // Na fala, todo item estudado serve: gera um exercício por item.
    picked = shuffle(items, rand).map((i, k) => ({
      id: `drill.speak.${k}`,
      type: 'speak' as const,
      skill: 'speaking' as const,
      lang,
      lessonId: i.id.split('.').slice(0, 4).join('.'),
      itemId: i.id,
      instruction: 'Ouça e repita em voz alta',
      prompt: display(lang, i.t),
      promptReading: i.r,
      audio: display(lang, i.t),
      accepted: [i.t, ...(i.alt ?? [])].map((t) => display(lang, t)),
      answerLang: lang,
      target: display(lang, i.t),
      reading: i.r,
      translation: i.pt,
    }));
  }
  return shuffle(picked, rand)
    .slice(0, count)
    .map((e) => ({ ...e, lessonId: e.itemId.split('.').slice(0, 4).join('.') }));
}

export interface Outcome {
  correct: boolean;
  grade?: GradeResult;
  speech?: SpeechComparison;
}

/** Corrige uma resposta escolhida, montada ou digitada. */
export function checkAnswer(ex: Exercise, answer: string): Outcome {
  if (ex.options) return { correct: answer === ex.accepted[0] };
  const grade = gradeText(answer, ex.accepted, ex.answerLang);
  return { correct: grade.correct, grade };
}

/** Confere a transcrição de um exercício de fala (reconhecimento, não avaliação fonética). */
export function checkSpeech(ex: Exercise, transcripts: string[]): Outcome {
  const speech = compareSpeech(transcripts, ex.accepted, ex.lang);
  return { correct: speech.matched, speech };
}

export interface SessionScore {
  total: number;
  correct: number;
  ratio: number;
  passed: boolean;
  bySkill: Partial<Record<Skill, { total: number; correct: number }>>;
}

export function scoreSession(results: { skill: Skill; correct: boolean }[]): SessionScore {
  const bySkill: SessionScore['bySkill'] = {};
  for (const r of results) {
    const s = (bySkill[r.skill] ??= { total: 0, correct: 0 });
    s.total++;
    if (r.correct) s.correct++;
  }
  const correct = results.filter((r) => r.correct).length;
  const ratio = results.length ? correct / results.length : 0;
  return { total: results.length, correct, ratio, passed: results.length > 0 && ratio >= PASS_RATIO, bySkill };
}
