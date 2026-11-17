import { LANGS, LEVEL_NAMES, type Item, type LangCode, type LessonContent, type Level } from '@/content';
import { AiError, parseJsonReply, type AiClient } from './client';

/**
 * Geração de lições com IA para unidades planejadas do currículo.
 * O resultado usa o mesmo formato das lições embutidas e fica salvo no aparelho (uso offline depois).
 * É conteúdo gerado por modelo: o app o identifica como tal, pois pode conter imprecisões.
 */
export const LESSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'objective', 'explanation', 'pronunciation', 'words', 'sentences', 'scenario'],
  properties: {
    title: { type: 'string' },
    objective: { type: 'string' },
    explanation: { type: 'array', items: { type: 'string' } },
    pronunciation: { type: 'array', items: { type: 'string' } },
    words: { type: 'array', items: { $ref: '#/$defs/item' } },
    sentences: { type: 'array', items: { $ref: '#/$defs/item' } },
    scenario: { type: 'string' },
  },
  $defs: {
    item: {
      type: 'object',
      additionalProperties: false,
      required: ['t', 'r', 'pt', 'alt', 'ptAlt'],
      properties: {
        t: { type: 'string' },
        r: { type: 'string' },
        pt: { type: 'string' },
        alt: { type: 'array', items: { type: 'string' } },
        ptAlt: { type: 'array', items: { type: 'string' } },
      },
    },
  },
} as const;

export interface LessonRequest {
  lang: LangCode;
  level: Level;
  unitId: string;
  unitTitle: string;
  unitGoals: string;
  /** Títulos das lições que já existem na unidade (para dar sequência, sem repetir). */
  existing: string[];
  /** Amostra de vocabulário já aprendido. */
  known: string[];
}

export function lessonSystemPrompt(req: LessonRequest): string {
  const L = LANGS[req.lang];
  return [
    `Você é autor de material didático de ${L.name} para brasileiros. Escreva UMA lição de nível ${req.level} (${LEVEL_NAMES[req.level]}) para a unidade "${req.unitTitle}" (objetivos da unidade: ${req.unitGoals}).`,
    req.existing.length ? `Lições já existentes nesta unidade (dê sequência, não repita): ${req.existing.join('; ')}.` : 'Esta é a primeira lição da unidade.',
    req.known.length ? `O aluno já conhece, entre outras: ${req.known.slice(0, 80).join(' | ')}. Não repita esses itens como vocabulário novo; reutilize-os nas frases.` : '',
    'Requisitos:',
    '- "objective": o que o aluno será capaz de fazer (uma frase, em português).',
    '- "explanation": 3 a 6 parágrafos em português, corretos e claros, com as regras e exemplos. Nada de afirmações gramaticais imprecisas.',
    '- "pronunciation": 0 a 3 observações de pronúncia úteis para brasileiros (em português).',
    `- "words": 8 a 10 palavras ou expressões novas. "sentences": 5 a 7 frases naturais (como um nativo diria), que usem as palavras da lição e a gramática explicada.`,
    '- Em cada item: "t" = texto no idioma; "pt" = tradução principal; "ptAlt" = outras traduções corretas em português; "alt" = outras formas igualmente corretas no idioma (contrações, variantes).',
    req.lang === 'zh'
      ? '- Mandarim: caracteres simplificados. Em "t", separe as PALAVRAS por um espaço (ex.: "我 是 学生"). Em "r", o pinyin com marcas de tom.'
      : req.lang === 'ko'
        ? '- Coreano: Hangul em "t" (com o espaçamento normal). Em "r", a romanização revisada.'
        : '- Deixe "r" vazio.',
    '- "scenario": uma situação de conversa (em português) para o aluno praticar esta lição com um professor.',
    'Responda SOMENTE com o objeto JSON.',
  ]
    .filter(Boolean)
    .join('\n');
}

interface RawItem {
  t?: unknown;
  r?: unknown;
  pt?: unknown;
  alt?: unknown;
  ptAlt?: unknown;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/** Valida a lição gerada. Rejeita (em vez de aceitar pela metade) quando falta conteúdo essencial. */
export function buildLessonFromAi(text: string, req: LessonRequest, sequence: number): LessonContent {
  const raw = parseJsonReply<Record<string, unknown>>(text);
  const id = `${req.unitId}.g${sequence}`;
  const needsReading = req.lang === 'ko' || req.lang === 'zh';
  const toItems = (list: unknown, prefix: 'w' | 's'): Item[] =>
    (Array.isArray(list) ? (list as RawItem[]) : [])
      .map((i) => ({ t: str(i.t).replace(/\s+/g, ' '), r: str(i.r), pt: str(i.pt), alt: strs(i.alt), ptAlt: strs(i.ptAlt) }))
      .filter((i) => i.t && i.pt && (!needsReading || i.r))
      .map((i, n) => ({
        id: `${id}.${prefix}${n + 1}`,
        kind: prefix === 'w' ? ('word' as const) : ('phrase' as const),
        t: i.t,
        pt: i.pt,
        ...(i.r && needsReading ? { r: i.r } : {}),
        ...(i.alt.length ? { alt: i.alt } : {}),
        ...(i.ptAlt.length ? { ptAlt: i.ptAlt } : {}),
      }));
  const words = toItems(raw.words, 'w');
  const sentences = toItems(raw.sentences, 's');
  const explanation = strs(raw.explanation);
  const title = str(raw.title);
  if (!title || explanation.length < 2 || words.length < 6 || sentences.length < 3) {
    throw new AiError('bad_response', 'A lição gerada veio incompleta e foi descartada. Tente gerar de novo.');
  }
  return {
    id,
    title,
    objective: str(raw.objective),
    explanation,
    pronunciation: strs(raw.pronunciation),
    words,
    sentences,
    reading: needsReading ? 'tap' : 'never',
    scenario: str(raw.scenario) || `Converse sobre o tema da lição "${title}".`,
  };
}

export async function generateLesson(ai: AiClient, req: LessonRequest, sequence: number): Promise<LessonContent> {
  const res = await ai.complete({
    kind: 'lesson',
    system: lessonSystemPrompt(req),
    messages: [{ role: 'user', content: 'Escreva a lição.' }],
    schema: LESSON_SCHEMA,
    maxTokens: 12000,
  });
  return buildLessonFromAi(res.text, req, sequence);
}
