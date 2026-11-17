import { LANGS, LEVEL_NAMES, type LangCode, type LessonContent, type Level } from '@/content';
import type { Message, TutorFeedback, WritingFeedback } from '@/db/repo';
import { AiError, parseJsonReply, type AiClient, type ChatMessage } from './client';

const LANG_NOTES: Record<LangCode, string> = {
  en: 'Erros típicos de brasileiros a observar: omitir o sujeito, "have" para idade, falsos cognatos (actually, pretend, parents), ordem adjetivo-substantivo, -s da 3ª pessoa. Distinga registro formal e informal quando for relevante.',
  es: 'Erros típicos de brasileiros a observar: portunhol, falsos cognatos (embarazada, exquisito, apellido), artigo antes de possessivo, "gustar", acentuação. Mencione diferenças regionais (Espanha × América Latina) quando forem relevantes.',
  ko: 'Use Hangul sempre. No campo reply_reading ponha a romanização revisada SOMENTE se o nível for A1; nos demais níveis deixe vazio. Use o estilo educado (-요) por padrão e explique formalidade e honoríficos quando aparecerem. Observe partículas (은/는, 이/가, 을/를) e ordem SOV.',
  zh: 'Use caracteres simplificados sempre. No campo reply_reading ponha o pinyin com marcas de tom SOMENTE se o nível for A1 ou A2; nos demais níveis deixe vazio. Observe classificadores, ordem das palavras, 了 e partículas. Ao corrigir pronúncia relatada por texto, dê atenção aos tons.',
};

const LEVEL_GUIDE: Record<Level, string> = {
  A1: 'frases muito curtas (até 8 palavras), presente, vocabulário de altíssima frequência, uma ideia por frase',
  A2: 'frases curtas, passado e futuro simples, vocabulário cotidiano',
  B1: 'frases conectadas, opiniões simples, vocabulário variado do dia a dia e do trabalho',
  B2: 'fala natural, expressões idiomáticas comuns, argumentação',
  C1: 'fala natural e rápida, nuance, registro variado, vocabulário abstrato',
  C2: 'sem restrições: humor, ironia, referências culturais',
};

export interface TutorContext {
  lang: LangCode;
  level: Level;
  /** Instrução do cenário (papel do professor). */
  scenario: string;
  studentName?: string;
  /** Vocabulário/frases já estudados, para o professor reaproveitar. */
  known?: string[];
  /** Itens em que o aluno mais erra, para revisão dentro da conversa. */
  weak?: string[];
  lesson?: Pick<LessonContent, 'title' | 'objective'>;
}

export function tutorSystemPrompt(ctx: TutorContext): string {
  const L = LANGS[ctx.lang];
  return [
    `Você é o professor particular de ${L.name} (${L.nativeName}) de um aluno brasileiro adulto${ctx.studentName ? ` chamado ${ctx.studentName}` : ''}. O idioma nativo do aluno é o português brasileiro.`,
    `Nível em estudo do aluno: ${ctx.level} (${LEVEL_NAMES[ctx.level]}). Ajuste sua fala a esse nível: ${LEVEL_GUIDE[ctx.level]}. Suba um pouco a dificuldade quando o aluno responder bem; simplifique quando ele tiver dificuldade.`,
    `Situação desta conversa: ${ctx.scenario}`,
    ctx.lesson ? `Esta conversa pratica a lição "${ctx.lesson.title}" (objetivo: ${ctx.lesson.objective}). Conduza a conversa de modo que o aluno precise usar esse conteúdo.` : '',
    ctx.known?.length ? `O aluno já estudou, entre outras, estas palavras e frases: ${ctx.known.slice(0, 60).join(' | ')}. Prefira vocabulário próximo disso e introduza poucas palavras novas por vez.` : '',
    ctx.weak?.length ? `O aluno costuma errar: ${ctx.weak.slice(0, 12).join(' | ')}. Crie oportunidades naturais para ele praticar esses itens.` : '',
    LANG_NOTES[ctx.lang],
    '',
    'Como conduzir:',
    `- Fale em ${L.name} no campo "reply". Mantenha o papel do cenário, faça uma pergunta ou proposta por vez e mantenha o contexto da conversa. Respostas curtas: no máximo 2 ou 3 frases.`,
    '- Ensine expressões naturais, do jeito que nativos falam, e diga quando algo é formal ou informal.',
    '- A fala do aluno pode ter vindo de reconhecimento de voz: ignore falta de pontuação e maiúsculas e não corrija isso.',
    '',
    'Como corrigir (campo "feedback", sempre em português):',
    '- Se a mensagem do aluno estiver correta e natural: ok=true e os demais campos vazios.',
    '- Se houver erro pela PRIMEIRA vez naquela frase: ok=false, escreva em "hint" uma dica que leve o aluno a se corrigir (aponte o tipo de erro e onde está, sem dar a frase pronta), deixe "corrected" vazio e, no "reply", peça com gentileza que ele tente de novo.',
    '- Se o aluno já tentou de novo e ainda errou, ou pediu a resposta: ok=false, ponha a versão certa em "corrected" e explique o porquê em "explanation" em uma ou duas frases. Depois siga a conversa.',
    '- Erros pequenos que não atrapalham a compreensão (em nível A1/A2): corrija direto em "corrected" com explicação curta, sem interromper a conversa.',
    '- Nunca invente erros. Aceite formas alternativas corretas.',
    '',
    'Pedidos especiais: mensagens do aluno que começam com "(Pedido)" são pedidos em português sobre a conversa (explicar, traduzir, repetir mais simples, dar a resposta). Atenda ao pedido; nesses casos use ok=true. Se o pedido for uma explicação, escreva a explicação em português no próprio "reply" e repita-a em "reply_pt".',
    '',
    'Formato: responda SOMENTE com um objeto JSON com os campos:',
    `"reply" (sua fala), "reply_reading" (leitura auxiliar conforme as regras acima, ou ""), "reply_pt" (tradução fiel da sua fala para português), "feedback" {"ok", "hint", "corrected", "explanation"}, "suggestions" (lista de 0 a 2 respostas possíveis em ${L.name}, no nível do aluno, para ele se inspirar — vazia quando você pediu que ele se corrija).`,
  ]
    .filter((s) => s !== '')
    .join('\n');
}

export const TUTOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'reply_reading', 'reply_pt', 'feedback', 'suggestions'],
  properties: {
    reply: { type: 'string' },
    reply_reading: { type: 'string' },
    reply_pt: { type: 'string' },
    feedback: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'hint', 'corrected', 'explanation'],
      properties: { ok: { type: 'boolean' }, hint: { type: 'string' }, corrected: { type: 'string' }, explanation: { type: 'string' } },
    },
    suggestions: { type: 'array', items: { type: 'string' } },
  },
} as const;

export interface TutorTurn {
  reply: string;
  reading: string | null;
  translation: string | null;
  /** Avaliação da última mensagem do aluno; null na abertura da conversa. */
  feedback: TutorFeedback | null;
  suggestions: string[];
}

interface RawTurn {
  reply?: unknown;
  reply_reading?: unknown;
  reply_pt?: unknown;
  feedback?: { ok?: unknown; hint?: unknown; corrected?: unknown; explanation?: unknown } | null;
  suggestions?: unknown;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function parseTutorTurn(text: string, opening: boolean): TutorTurn {
  const raw = parseJsonReply<RawTurn>(text);
  const reply = str(raw.reply);
  if (!reply) throw new AiError('bad_response', 'O professor respondeu em um formato inesperado. Tente de novo.');
  const f = raw.feedback;
  const feedback: TutorFeedback | null =
    opening || !f || typeof f.ok !== 'boolean'
      ? null
      : f.ok
        ? { ok: true }
        : { ok: false, hint: str(f.hint) || undefined, corrected: str(f.corrected) || undefined, explanation: str(f.explanation) || undefined };
  return {
    reply,
    reading: str(raw.reply_reading) || null,
    translation: str(raw.reply_pt) || null,
    feedback,
    suggestions: Array.isArray(raw.suggestions) ? raw.suggestions.map(str).filter(Boolean).slice(0, 2) : [],
  };
}

export const OPENING = '(Pedido) Comece a conversa agora: cumprimente o aluno dentro do cenário e faça a primeira pergunta.';
const HISTORY_LIMIT = 30;

/** Reconstrói o histórico no formato que o modelo produziu, para ele manter contexto e lembrar as dicas já dadas. */
export function buildHistory(messages: Pick<Message, 'role' | 'content' | 'translation' | 'feedback_json'>[]): ChatMessage[] {
  const out: ChatMessage[] = [{ role: 'user', content: OPENING }];
  let pending: TutorFeedback | null = null;
  for (const m of messages) {
    if (m.role === 'user') {
      pending = m.feedback_json ? (JSON.parse(m.feedback_json) as TutorFeedback) : null;
      out.push({ role: 'user', content: m.content });
    } else {
      const fb = pending ?? { ok: true };
      out.push({
        role: 'assistant',
        content: JSON.stringify({
          reply: m.content,
          reply_reading: '',
          reply_pt: m.translation ?? '',
          feedback: { ok: fb.ok, hint: fb.hint ?? '', corrected: fb.corrected ?? '', explanation: fb.explanation ?? '' },
          suggestions: [],
        }),
      });
      pending = null;
    }
  }
  // Mantém a abertura e as mensagens mais recentes; o corte sempre começa em uma fala do aluno.
  if (out.length > HISTORY_LIMIT) {
    let start = out.length - HISTORY_LIMIT;
    while (start < out.length && out[start].role !== 'user') start++;
    return out.slice(start);
  }
  return out;
}

/**
 * Um turno da conversa. `stored` são as mensagens já salvas (incluindo a última fala do aluno, se houver).
 * Com `stored` vazio, o professor abre a conversa.
 */
export async function tutorTurn(ai: AiClient, ctx: TutorContext, stored: Pick<Message, 'role' | 'content' | 'translation' | 'feedback_json'>[]): Promise<TutorTurn> {
  const res = await ai.complete({ kind: 'tutor', system: tutorSystemPrompt(ctx), messages: buildHistory(stored), schema: TUTOR_SCHEMA, maxTokens: 4000 });
  return parseTutorTurn(res.text, stored.length === 0);
}

// ---------- Correção de escrita ----------

export const WRITING_TASKS = [
  { id: 'sentence', title: 'Frase livre', hint: 'Escreva uma ou duas frases sobre o tema.' },
  { id: 'answer', title: 'Responder pergunta', hint: 'Responda à pergunta com frases completas.' },
  { id: 'short', title: 'Pequeno texto', hint: 'Escreva um parágrafo curto (3 a 6 frases).' },
  { id: 'dialogue', title: 'Diálogo', hint: 'Escreva um diálogo curto entre duas pessoas.' },
  { id: 'fix', title: 'Corrigir frase', hint: 'Reescreva a frase corrigindo os erros.' },
  { id: 'essay', title: 'Redação', hint: 'Desenvolva o tema em um texto organizado, com introdução e conclusão.' },
] as const;
export type WritingTaskId = (typeof WRITING_TASKS)[number]['id'];

export const WRITING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['corrected', 'summary', 'level_estimate', 'strengths', 'issues'],
  properties: {
    corrected: { type: 'string' },
    summary: { type: 'string' },
    level_estimate: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'original', 'suggestion', 'explanation'],
        properties: {
          category: { type: 'string', enum: ['ortografia', 'gramática', 'vocabulário', 'ordem das palavras', 'concordância', 'contexto', 'naturalidade', 'adequação ao nível'] },
          original: { type: 'string' },
          suggestion: { type: 'string' },
          explanation: { type: 'string' },
        },
      },
    },
  },
} as const;

export function writingSystemPrompt(lang: LangCode, level: Level): string {
  const L = LANGS[lang];
  return [
    `Você corrige textos em ${L.name} escritos por um aluno brasileiro de nível ${level} (${LEVEL_NAMES[level]}).`,
    'Analise ortografia, gramática, vocabulário, ordem das palavras, concordância, adequação ao contexto pedido, naturalidade e adequação ao nível.',
    'Aceite qualquer forma correta: não exija uma resposta específica nem "corrija" escolhas válidas de estilo. Se o texto estiver certo, devolva "issues" vazio.',
    'Explique cada problema em português, de forma curta e didática, dizendo a regra. Em "corrected", devolva o texto do aluno corrigido preservando ao máximo as escolhas dele.',
    'Em "summary", dê um parecer geral em português (2 a 3 frases) com o próximo passo de estudo. Em "strengths", liste até 3 pontos positivos concretos.',
    'Em "level_estimate", estime o nível CEFR que este texto demonstra (ex.: "A2"). É só uma estimativa a partir de um texto curto.',
    LANG_NOTES[lang],
    'Responda SOMENTE com o objeto JSON pedido.',
  ].join('\n');
}

interface RawWriting {
  corrected?: unknown;
  summary?: unknown;
  level_estimate?: unknown;
  strengths?: unknown;
  issues?: unknown;
}

export function parseWriting(text: string): WritingFeedback {
  const raw = parseJsonReply<RawWriting>(text);
  const corrected = str(raw.corrected);
  const summary = str(raw.summary);
  if (!corrected && !summary) throw new AiError('bad_response', 'A correção veio em um formato inesperado. Tente de novo.');
  const issues = Array.isArray(raw.issues)
    ? raw.issues
        .map((i) => i as Record<string, unknown>)
        .map((i) => ({ category: str(i.category) || 'gramática', original: str(i.original), suggestion: str(i.suggestion), explanation: str(i.explanation) }))
        .filter((i) => i.explanation || i.suggestion)
    : [];
  return {
    corrected,
    summary,
    issues,
    levelEstimate: str(raw.level_estimate) || undefined,
    strengths: Array.isArray(raw.strengths) ? raw.strengths.map(str).filter(Boolean).slice(0, 3) : [],
  };
}

export async function correctWriting(ai: AiClient, lang: LangCode, level: Level, task: string, prompt: string, text: string): Promise<WritingFeedback> {
  const res = await ai.complete({
    kind: 'writing',
    system: writingSystemPrompt(lang, level),
    messages: [{ role: 'user', content: `Tipo de atividade: ${task}\nEnunciado: ${prompt}\n\nTexto do aluno:\n${text}` }],
    schema: WRITING_SCHEMA,
    maxTokens: 6000,
  });
  return parseWriting(res.text);
}

/** Temas de escrita por nível (enunciados em português; o aluno escreve no idioma estudado). */
export const WRITING_PROMPTS: Record<WritingTaskId, Partial<Record<Level, string[]>>> = {
  sentence: {
    A1: ['Apresente-se: nome e de onde você é.', 'Diga o que você gosta de comer e beber.', 'Fale de uma pessoa da sua família.'],
    A2: ['Conte o que você fez ontem.', 'Descreva seus planos para o fim de semana.'],
    B1: ['Dê sua opinião sobre trabalhar de casa.', 'Descreva um lugar que você gostaria de conhecer e por quê.'],
  },
  answer: {
    A1: ['Como você se chama e de onde você é?', 'Quantas pessoas há na sua família?', 'O que você estuda ou em que trabalha?'],
    A2: ['Como é um dia típico da sua semana?', 'O que você costuma fazer nas férias?'],
    B1: ['Qual foi a viagem mais marcante que você fez? Por quê?', 'O que você mudaria na sua cidade?'],
  },
  short: {
    A1: ['Escreva sobre você: nome, origem, família e do que gosta.', 'Descreva o que você come em um dia.'],
    A2: ['Descreva sua casa ou seu bairro.', 'Conte como foi seu último fim de semana.'],
    B1: ['Conte uma experiência em que você aprendeu algo importante.', 'Compare a vida em cidade grande e em cidade pequena.'],
  },
  dialogue: {
    A1: ['Duas pessoas se conhecem e se apresentam.', 'Um cliente pede comida em um restaurante.'],
    A2: ['Um turista pede informações na rua.', 'Dois amigos combinam um programa para sábado.'],
    B1: ['Um hóspede reclama de um problema no quarto do hotel.', 'Uma entrevista de emprego: três perguntas e respostas.'],
  },
  fix: {},
  essay: {
    B1: ['As redes sociais aproximam ou afastam as pessoas?'],
    B2: ['A inteligência artificial vai mudar o trabalho para melhor ou para pior?', 'Deve-se limitar o turismo em lugares muito visitados?'],
    C1: ['Até que ponto o crescimento econômico é compatível com a preservação ambiental?'],
  },
};

/** Frases com erros típicos de brasileiros para o exercício "corrigir frase" (conteúdo local). */
export const FIX_SENTENCES: Record<LangCode, string[]> = {
  en: ['I have 25 years.', 'She work in a bank.', 'I am agree with you.', 'He don\'t like coffee.', 'Is very cold today.', 'I live here since 2020.'],
  es: ['Yo gusto de café.', 'La mi madre es profesora.', 'Estoy embarazado de hablar en público.', 'Tengo que ir en el banco.', 'Ella es en casa.', 'Yo soy con hambre.'],
  ko: ['저는 학생이 입니다.', '커피을 마셔요.', '저는 학교를 가요.', '이것은 책예요.', '친구를 있어요.', '물를 주세요.'],
  zh: ['我是很好。', '我有二个朋友。', '我不有书。', '你叫什么名字吗？', '我三个朋友有。', '他是不老师。'],
};

export function pickWritingPrompt(task: WritingTaskId, lang: LangCode, level: Level, seed: number): string {
  if (task === 'fix') {
    const list = FIX_SENTENCES[lang];
    return list[seed % list.length];
  }
  const byLevel = WRITING_PROMPTS[task];
  const order: Level[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  // Usa o tema do nível do aluno ou, se não houver, o do nível disponível mais próximo.
  const idx = order.indexOf(level);
  const sorted = [...order].sort((a, b) => Math.abs(order.indexOf(a) - idx) - Math.abs(order.indexOf(b) - idx));
  const list = sorted.map((l) => byLevel[l]).find((x) => x?.length) ?? ['Escreva sobre o seu dia.'];
  return list[seed % list.length];
}
