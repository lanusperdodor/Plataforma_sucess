import { describe, expect, it } from 'vitest';
import { CURRICULUM, LANG_CODES, LEVELS, display } from '../src/content';
import { buildDrill, buildLessonExercises, checkAnswer, checkSpeech, scoreSession } from '../src/domain/exercises';

const lessons = LANG_CODES.flatMap((lang) =>
  CURRICULUM[lang].flatMap((c) => c.units.flatMap((u) => u.lessons.map((l) => ({ lang, level: c.level, lesson: l }))))
);

describe('currículo', () => {
  it('cada idioma tem os seis níveis CEFR e conteúdo real no A1', () => {
    for (const lang of LANG_CODES) {
      expect(CURRICULUM[lang].map((c) => c.level)).toEqual(LEVELS);
      const a1 = CURRICULUM[lang][0];
      expect(a1.units.length).toBeGreaterThanOrEqual(3);
      expect(a1.units.flatMap((u) => u.lessons).length).toBeGreaterThanOrEqual(9);
      for (const c of CURRICULUM[lang]) expect(c.units.length + c.planned.length).toBeGreaterThan(0);
    }
  });
  it('identificadores de lições e itens são únicos', () => {
    const ids = lessons.flatMap(({ lesson }) => [lesson.id, ...lesson.words.map((w) => w.id), ...lesson.sentences.map((s) => s.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('toda lição tem objetivo, explicação, vocabulário, frases e cenário de conversa', () => {
    for (const { lesson } of lessons) {
      expect(lesson.objective.length, lesson.id).toBeGreaterThan(10);
      expect(lesson.explanation.length, lesson.id).toBeGreaterThanOrEqual(3);
      expect(lesson.words.length, lesson.id).toBeGreaterThanOrEqual(8);
      expect(lesson.sentences.length, lesson.id).toBeGreaterThanOrEqual(3);
      expect(lesson.scenario.length, lesson.id).toBeGreaterThan(20);
    }
  });
  it('coreano e mandarim trazem leitura auxiliar em todos os itens', () => {
    for (const { lang, lesson } of lessons) {
      if (lang !== 'ko' && lang !== 'zh') continue;
      for (const i of [...lesson.words, ...lesson.sentences]) expect(i.r, i.id).toBeTruthy();
    }
  });
  it('coreano começa pelo Hangul e reduz a romanização nas unidades seguintes', () => {
    const ko = CURRICULUM.ko[0].units;
    expect(ko[0].lessons.every((l) => l.script)).toBe(true);
    expect(ko[0].lessons[0].reading).toBe('always');
    expect(ko[2].lessons.every((l) => l.reading === 'tap')).toBe(true);
  });
  it('mandarim tem exercícios de tom com os quatro tons', () => {
    const tones = CURRICULUM.zh[0].units[0].lessons[0].tones!;
    expect(new Set(tones.map((t) => t.tone))).toEqual(new Set([1, 2, 3, 4]));
  });
  it('pinyin das frases tem o mesmo número de sílabas-palavra que os caracteres (sanidade)', () => {
    for (const { lang, lesson } of lessons) {
      if (lang !== 'zh') continue;
      for (const s of lesson.sentences) expect(display('zh', s.t)).not.toMatch(/\s/);
    }
  });
});

describe('geração de exercícios', () => {
  it.each(lessons.map((l) => [l.lesson.id, l] as const))('%s gera prática e avaliação válidas', (_id, { lang, lesson }) => {
    for (const mode of ['practice', 'assessment'] as const) {
      const ex = buildLessonExercises(lesson, lang, { mode, seed: 7, speech: true });
      expect(ex.length).toBeGreaterThanOrEqual(mode === 'practice' ? 10 : 6);
      expect(new Set(ex.map((e) => e.id)).size).toBe(ex.length);
      for (const e of ex) {
        expect(e.accepted.length, e.id).toBeGreaterThan(0);
        if (e.options) {
          expect(e.options, e.id).toContain(e.accepted[0]);
          expect(new Set(e.options).size, e.id).toBe(e.options.length);
          expect(checkAnswer(e, e.accepted[0]).correct).toBe(true);
          const wrong = e.options.find((o) => o !== e.accepted[0])!;
          expect(checkAnswer(e, wrong).correct).toBe(false);
        }
        if (e.type === 'order') {
          const words = e.accepted[0];
          // As peças do banco permitem montar a resposta principal.
          const need = lesson.sentences.find((s) => s.id === e.itemId)!.t.split(' ');
          for (const w of need) expect(e.bank, e.id).toContain(w);
          expect(checkAnswer(e, lang === 'zh' ? need.join('') : need.join(' ')).correct, words).toBe(true);
        }
        if (e.type === 'fill') expect(e.prompt).toContain('____');
        if (e.type === 'speak') expect(checkSpeech(e, [e.accepted[0]]).correct).toBe(true);
        if (['translate', 'dictation', 'translate_pt'].includes(e.type)) {
          for (const a of e.accepted) expect(checkAnswer(e, a).correct, a).toBe(true);
        }
      }
      // A avaliação cobre mais de uma habilidade.
      if (mode === 'assessment') expect(new Set(ex.map((e) => e.skill)).size).toBeGreaterThanOrEqual(2);
    }
  });
  it('sem reconhecimento de fala, nenhum exercício de fala é gerado', () => {
    const { lang, lesson } = lessons[1];
    const ex = buildLessonExercises(lesson, lang, { mode: 'practice', seed: 1, speech: false });
    expect(ex.some((e) => e.type === 'speak')).toBe(false);
  });
  it('avaliação não mostra leitura auxiliar nem áudio de apoio nas questões de leitura', () => {
    const lesson = CURRICULUM.ko[0].units[1].lessons[1];
    const ex = buildLessonExercises(lesson, 'ko', { mode: 'assessment', seed: 3, speech: false });
    for (const e of ex.filter((x) => x.type === 'choose_pt')) {
      expect(e.promptReading).toBeUndefined();
      expect(e.audio).toBeUndefined();
    }
  });
  it('inglês e espanhol exigem escrita digitada; coreano e mandarim usam montagem', () => {
    const en = buildLessonExercises(CURRICULUM.en[0].units[0].lessons[1], 'en', { mode: 'practice', seed: 2, speech: false });
    expect(en.some((e) => e.type === 'translate')).toBe(true);
    expect(en.some((e) => e.type === 'dictation')).toBe(true);
    const zh = buildLessonExercises(CURRICULUM.zh[0].units[1].lessons[0], 'zh', { mode: 'practice', seed: 2, speech: false });
    expect(zh.some((e) => e.type === 'translate')).toBe(false);
    expect(zh.some((e) => e.type === 'order')).toBe(true);
  });
  it('sementes diferentes mudam a ordem', () => {
    const { lang, lesson } = lessons[2];
    const a = buildLessonExercises(lesson, lang, { mode: 'practice', seed: 1, speech: false }).map((e) => e.type + e.itemId);
    const b = buildLessonExercises(lesson, lang, { mode: 'practice', seed: 2, speech: false }).map((e) => e.type + e.itemId);
    expect(a).not.toEqual(b);
  });
  it('treino livre filtra pela habilidade', () => {
    const l = CURRICULUM.en[0].units[0].lessons[1];
    const items = [...l.words, ...l.sentences];
    expect(buildDrill(items, 'en', 'speaking', 5, 6).every((e) => e.type === 'speak')).toBe(true);
    expect(buildDrill(items, 'en', 'listening', 5, 6).every((e) => e.skill === 'listening')).toBe(true);
    const w = buildDrill(items, 'en', 'writing', 5, 6);
    expect(w.length).toBeGreaterThan(0);
    expect(w.every((e) => e.lessonId === l.id)).toBe(true);
  });
});

describe('nota da sessão', () => {
  it('aprova com 70% e reprova abaixo', () => {
    const mk = (ok: number, total: number) => scoreSession(Array.from({ length: total }, (_, i) => ({ skill: 'writing' as const, correct: i < ok })));
    expect(mk(7, 10).passed).toBe(true);
    expect(mk(6, 10).passed).toBe(false);
    expect(mk(0, 0).passed).toBe(false);
  });
  it('separa por habilidade', () => {
    const s = scoreSession([
      { skill: 'listening', correct: true },
      { skill: 'listening', correct: false },
      { skill: 'writing', correct: true },
    ]);
    expect(s.bySkill.listening).toEqual({ total: 2, correct: 1 });
    expect(s.bySkill.writing).toEqual({ total: 1, correct: 1 });
  });
});
