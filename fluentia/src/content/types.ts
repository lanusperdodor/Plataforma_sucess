export type LangCode = 'en' | 'es' | 'ko' | 'zh';
export type Level = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
export const LEVELS: Level[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const LEVEL_NAMES: Record<Level, string> = {
  A1: 'Iniciante',
  A2: 'Básico',
  B1: 'Intermediário',
  B2: 'Intermediário avançado',
  C1: 'Avançado',
  C2: 'Proficiência',
};

export interface LangMeta {
  code: LangCode;
  name: string; // em português
  nativeName: string;
  flag: string;
  /** Locale usado na síntese e no reconhecimento de fala. */
  locale: string;
  /** true quando as palavras não são separadas por espaço na escrita (mandarim). */
  noSpaces: boolean;
  /** Nome do sistema de leitura auxiliar (romanização / pinyin). */
  readingName?: string;
  /** Referência de exame própria do idioma, exibida ao lado do CEFR sem equivalência direta. */
  examRef: Partial<Record<Level, string>>;
}

export const LANGS: Record<LangCode, LangMeta> = {
  en: { code: 'en', name: 'Inglês', nativeName: 'English', flag: '🇺🇸', locale: 'en-US', noSpaces: false, examRef: {} },
  es: { code: 'es', name: 'Espanhol', nativeName: 'Español', flag: '🇪🇸', locale: 'es-ES', noSpaces: false, examRef: {} },
  ko: {
    code: 'ko',
    name: 'Coreano',
    nativeName: '한국어',
    flag: '🇰🇷',
    locale: 'ko-KR',
    noSpaces: false,
    readingName: 'Romanização',
    examRef: {
      A1: 'conteúdos próximos do TOPIK I (1급)',
      A2: 'conteúdos próximos do TOPIK I (2급)',
      B1: 'conteúdos próximos do TOPIK II (3급)',
      B2: 'conteúdos próximos do TOPIK II (4급)',
      C1: 'conteúdos próximos do TOPIK II (5급)',
      C2: 'conteúdos próximos do TOPIK II (6급)',
    },
  },
  zh: {
    code: 'zh',
    name: 'Mandarim',
    nativeName: '中文',
    flag: '🇨🇳',
    locale: 'zh-CN',
    noSpaces: true,
    readingName: 'Pinyin',
    examRef: {
      A1: 'conteúdos próximos do HSK 1',
      A2: 'conteúdos próximos do HSK 2',
      B1: 'conteúdos próximos do HSK 3',
      B2: 'conteúdos próximos do HSK 4',
      C1: 'conteúdos próximos do HSK 5',
      C2: 'conteúdos próximos do HSK 6+',
    },
  },
};
export const LANG_CODES: LangCode[] = ['en', 'es', 'ko', 'zh'];

/** Palavra ou frase ensinada. Em mandarim, `t` traz as palavras separadas por espaço (removidos na exibição). */
export interface Item {
  id: string;
  kind: 'word' | 'phrase';
  /** Texto no idioma estudado. */
  t: string;
  /** Leitura auxiliar: romanização (coreano) ou pinyin (mandarim). */
  r?: string;
  /** Tradução principal em português. */
  pt: string;
  /** Outras formas corretas no idioma estudado. */
  alt?: string[];
  /** Outras traduções corretas em português. */
  ptAlt?: string[];
}

export interface ToneDrill {
  /** Sílaba com marca de tom, ex.: "mā". */
  pinyin: string;
  hanzi: string;
  tone: 1 | 2 | 3 | 4 | 5;
  pt: string;
}

export interface LessonContent {
  id: string;
  title: string;
  objective: string;
  /** Parágrafos de explicação em português. */
  explanation: string[];
  /** Observações de pronúncia específicas para brasileiros. */
  pronunciation?: string[];
  words: Item[];
  sentences: Item[];
  tones?: ToneDrill[];
  /**
   * Como exibir a leitura auxiliar nesta lição:
   * 'always' (início), 'tap' (só ao tocar) ou 'never'. Reduz a dependência de romanização aos poucos.
   */
  reading: 'always' | 'tap' | 'never';
  /** Situação para praticar com o professor virtual ao final da lição. */
  scenario: string;
  /** Lição de sistema de escrita (alfabeto, Hangul, pinyin): sem tradução digitada. */
  script?: boolean;
}

export interface UnitContent {
  id: string;
  title: string;
  description: string;
  lessons: LessonContent[];
}

export interface PlannedUnit {
  title: string;
  goals: string;
}

export interface CourseContent {
  lang: LangCode;
  level: Level;
  title: string;
  units: UnitContent[];
  /** Unidades previstas no currículo, ainda sem lições escritas (podem ser geradas com IA). */
  planned: PlannedUnit[];
}

/** Texto como deve aparecer na tela (sem os espaços de segmentação do mandarim). */
export function display(lang: LangCode, t: string): string {
  return LANGS[lang].noSpaces ? t.replace(/\s+/g, '') : t;
}
