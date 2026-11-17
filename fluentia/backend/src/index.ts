import Anthropic from '@anthropic-ai/sdk';

export interface Env {
  APP_TOKEN?: string;
  PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_EFFORT?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  AZURE_SPEECH_KEY?: string;
  AZURE_SPEECH_REGION?: string;
  DAILY_REQUEST_LIMIT?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface CompleteBody {
  system?: string;
  messages?: ChatMessage[];
  /** JSON Schema da resposta, quando o app precisa de saída estruturada. */
  schema?: Record<string, unknown>;
  maxTokens?: number;
}

interface Completion {
  text: string;
  model: string;
  usage: { input: number; output: number };
}

const MAX_BODY_BYTES = 64 * 1024;
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
const MAX_MESSAGES = 60;
const MAX_OUTPUT_TOKENS = 16000;
const PER_MINUTE_LIMIT = 20;
const UPSTREAM_TIMEOUT_MS = 60_000;

// Modelos que aceitam o parâmetro de fallback do lado do servidor em caso de recusa.
const FALLBACK_MODELS = new Set(['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/** Comparação em tempo constante, para não vazar o token por diferença de tempo. */
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

function authorize(req: Request, env: Env): void {
  if (!env.APP_TOKEN || env.APP_TOKEN.length < 16) {
    throw new HttpError(503, 'not_configured', 'Backend sem APP_TOKEN configurado (mínimo de 16 caracteres).');
  }
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!safeEqual(token, env.APP_TOKEN)) throw new HttpError(401, 'unauthorized', 'Token inválido.');
}

/**
 * Limites de requisição em memória (por instância do Worker). É uma trava de custo simples para uso pessoal:
 * instâncias diferentes têm contadores separados, então o limite real pode ser um pouco maior.
 * O teto de gastos de verdade deve ser configurado no painel do provedor de IA.
 */
const counters = { minute: 0, minuteCount: 0, day: '', dayCount: 0 };

export function resetLimitsForTests(): void {
  counters.minute = 0;
  counters.minuteCount = 0;
  counters.day = '';
  counters.dayCount = 0;
}

function rateLimit(env: Env, now = Date.now()): void {
  const minute = Math.floor(now / 60_000);
  const day = new Date(now).toISOString().slice(0, 10);
  if (counters.minute !== minute) {
    counters.minute = minute;
    counters.minuteCount = 0;
  }
  if (counters.day !== day) {
    counters.day = day;
    counters.dayCount = 0;
  }
  const daily = Number(env.DAILY_REQUEST_LIMIT ?? '300') || 300;
  if (counters.minuteCount >= PER_MINUTE_LIMIT) throw new HttpError(429, 'rate_limited', 'Muitas requisições neste minuto. Aguarde um pouco.');
  if (counters.dayCount >= daily) throw new HttpError(429, 'daily_limit', 'Limite diário de requisições de IA atingido.');
  counters.minuteCount++;
  counters.dayCount++;
}

function validate(body: CompleteBody): Required<Pick<CompleteBody, 'messages'>> & CompleteBody {
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    throw new HttpError(400, 'bad_request', 'Campo "messages" obrigatório.');
  }
  if (body.messages.length > MAX_MESSAGES) throw new HttpError(400, 'bad_request', 'Conversa longa demais.');
  for (const m of body.messages) {
    if ((m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content) {
      throw new HttpError(400, 'bad_request', 'Mensagem inválida.');
    }
  }
  if (body.messages[0].role !== 'user') throw new HttpError(400, 'bad_request', 'A primeira mensagem deve ser do usuário.');
  if (body.system !== undefined && typeof body.system !== 'string') throw new HttpError(400, 'bad_request', 'Campo "system" inválido.');
  return body as Required<Pick<CompleteBody, 'messages'>> & CompleteBody;
}

async function completeAnthropic(env: Env, body: CompleteBody): Promise<Completion> {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, 'not_configured', 'ANTHROPIC_API_KEY não configurada no backend.');
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: UPSTREAM_TIMEOUT_MS, maxRetries: 1 });
  const model = env.ANTHROPIC_MODEL || 'claude-opus-5-5';
  const effort = (env.ANTHROPIC_EFFORT || 'low') as 'low' | 'medium' | 'high';
  const params = {
    model,
    max_tokens: Math.min(body.maxTokens ?? MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS),
    // As instruções do professor são longas e estáveis: o cache barateia as requisições seguintes.
    system: body.system ? [{ type: 'text' as const, text: body.system, cache_control: { type: 'ephemeral' as const } }] : undefined,
    messages: body.messages!,
    output_config: {
      effort,
      ...(body.schema ? { format: { type: 'json_schema' as const, schema: body.schema } } : {}),
    },
  };
  try {
    const res = FALLBACK_MODELS.has(model)
      ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await client.messages.create(params);
    if (res.stop_reason === 'refusal') {
      throw new HttpError(422, 'refusal', 'O modelo recusou esta solicitação. Reformule a mensagem.');
    }
    let text = '';
    for (const block of res.content) if (block.type === 'text') text += block.text;
    if (!text) throw new HttpError(502, 'empty_response', 'O modelo não retornou texto.');
    if (res.stop_reason === 'max_tokens') throw new HttpError(502, 'truncated', 'A resposta do modelo foi cortada pelo limite de tokens.');
    return { text, model: res.model, usage: { input: res.usage.input_tokens, output: res.usage.output_tokens } };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(503, 'provider_auth', 'A chave da Anthropic no backend é inválida.');
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'provider_rate_limited', 'O provedor de IA está limitando as requisições. Tente em instantes.');
    if (e instanceof Anthropic.BadRequestError) throw new HttpError(502, 'provider_bad_request', 'O provedor de IA rejeitou a requisição.');
    if (e instanceof Anthropic.APIConnectionError) throw new HttpError(504, 'provider_unreachable', 'Não foi possível falar com o provedor de IA.');
    if (e instanceof Anthropic.APIError) throw new HttpError(502, 'provider_error', `Erro do provedor de IA (${e.status ?? '?'}).`);
    throw e;
  }
}

/** Provedores com API no formato "chat completions" (vários têm cota gratuita). */
async function completeOpenAiCompatible(env: Env, body: CompleteBody): Promise<Completion> {
  if (!env.OPENAI_API_KEY || !env.OPENAI_BASE_URL || !env.OPENAI_MODEL) {
    throw new HttpError(503, 'not_configured', 'Configure OPENAI_API_KEY, OPENAI_BASE_URL e OPENAI_MODEL no backend.');
  }
  const messages = [
    ...(body.system ? [{ role: 'system', content: body.schema ? `${body.system}\n\nResponda somente com um objeto JSON válido.` : body.system }] : []),
    ...body.messages!,
  ];
  let res: Response;
  try {
    res = await fetch(`${env.OPENAI_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        messages,
        max_tokens: Math.min(body.maxTokens ?? 4000, MAX_OUTPUT_TOKENS),
        ...(body.schema ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    throw new HttpError(504, 'provider_unreachable', 'Não foi possível falar com o provedor de IA.');
  }
  if (res.status === 401 || res.status === 403) throw new HttpError(503, 'provider_auth', 'A chave do provedor de IA no backend é inválida.');
  if (res.status === 429) throw new HttpError(429, 'provider_rate_limited', 'O provedor de IA está limitando as requisições (cota).');
  if (!res.ok) throw new HttpError(502, 'provider_error', `Erro do provedor de IA (${res.status}).`);
  const data = (await res.json()) as {
    model?: string;
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text) throw new HttpError(502, 'empty_response', 'O modelo não retornou texto.');
  return { text, model: data.model ?? env.OPENAI_MODEL, usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 } };
}

const provider = (env: Env) => (env.PROVIDER === 'openai-compatible' ? 'openai-compatible' : 'anthropic');

/**
 * Avaliação fonética real (precisão, fluência, completude e prosódia) pelo Azure AI Speech.
 * Recebe WAV PCM 16 kHz mono. ATENÇÃO: implementado conforme a documentação pública, ainda não
 * validado contra uma conta real — ver docs/SERVICOS.md.
 */
async function assessPronunciation(req: Request, env: Env, url: URL): Promise<Response> {
  if (!env.AZURE_SPEECH_KEY || !env.AZURE_SPEECH_REGION) {
    throw new HttpError(501, 'pronunciation_unavailable', 'Avaliação fonética não configurada no backend.');
  }
  const language = url.searchParams.get('lang') ?? '';
  const reference = url.searchParams.get('text') ?? '';
  if (!/^[a-z]{2}-[A-Z]{2}$/.test(language) || !reference || reference.length > 300) {
    throw new HttpError(400, 'bad_request', 'Parâmetros "lang" e "text" obrigatórios.');
  }
  const audio = await req.arrayBuffer();
  if (audio.byteLength === 0 || audio.byteLength > MAX_AUDIO_BYTES) throw new HttpError(413, 'bad_audio', 'Áudio vazio ou grande demais.');
  const config = {
    ReferenceText: reference,
    GradingSystem: 'HundredMark',
    Granularity: 'Phoneme',
    Dimension: 'Comprehensive',
    EnableProsodyAssessment: language === 'en-US',
  };
  const bytes = new TextEncoder().encode(JSON.stringify(config));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  let res: Response;
  try {
    res = await fetch(
      `https://${env.AZURE_SPEECH_REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${language}&format=detailed`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY,
          'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
          Accept: 'application/json',
          'Pronunciation-Assessment': btoa(bin),
        },
        body: audio,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      }
    );
  } catch {
    throw new HttpError(504, 'provider_unreachable', 'Não foi possível falar com o serviço de avaliação fonética.');
  }
  if (!res.ok) throw new HttpError(502, 'provider_error', `Erro do serviço de avaliação fonética (${res.status}).`);
  const data = (await res.json()) as {
    RecognitionStatus?: string;
    NBest?: {
      Display?: string;
      AccuracyScore?: number;
      FluencyScore?: number;
      CompletenessScore?: number;
      ProsodyScore?: number;
      PronScore?: number;
      Words?: { Word?: string; AccuracyScore?: number; ErrorType?: string }[];
    }[];
  };
  const best = data.NBest?.[0];
  if (data.RecognitionStatus !== 'Success' || !best || typeof best.AccuracyScore !== 'number') {
    throw new HttpError(422, 'no_speech', 'O serviço não reconheceu fala no áudio.');
  }
  return json({
    provider: 'azure-speech',
    recognized: best.Display ?? '',
    accuracy: best.AccuracyScore,
    fluency: best.FluencyScore ?? null,
    completeness: best.CompletenessScore ?? null,
    prosody: best.ProsodyScore ?? null,
    overall: best.PronScore ?? null,
    words: (best.Words ?? []).map((w) => ({ word: w.Word ?? '', accuracy: w.AccuracyScore ?? null, error: w.ErrorType ?? 'None' })),
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const started = Date.now();
    let status = 200;
    try {
      // Página pública mínima: confirma que o backend está no ar, sem expor configuração.
      if (req.method === 'GET' && url.pathname === '/') {
        return new Response('Fluentia backend online. Use o app para se conectar.', { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
      }
      if (!url.pathname.startsWith('/v1/')) throw new HttpError(404, 'not_found', 'Rota inexistente.');
      authorize(req, env);

      if (req.method === 'GET' && url.pathname === '/v1/health') {
        const p = provider(env);
        const ready = p === 'anthropic' ? !!env.ANTHROPIC_API_KEY : !!(env.OPENAI_API_KEY && env.OPENAI_BASE_URL && env.OPENAI_MODEL);
        return json({
          ok: true,
          provider: p,
          model: p === 'anthropic' ? env.ANTHROPIC_MODEL || 'claude-opus-5-5' : env.OPENAI_MODEL ?? null,
          llm: ready,
          pronunciation: !!(env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION),
        });
      }

      if (req.method === 'POST' && url.pathname === '/v1/complete') {
        rateLimit(env);
        const raw = await req.text();
        if (raw.length > MAX_BODY_BYTES) throw new HttpError(413, 'too_large', 'Requisição grande demais.');
        let parsed: CompleteBody;
        try {
          parsed = JSON.parse(raw) as CompleteBody;
        } catch {
          throw new HttpError(400, 'bad_request', 'JSON inválido.');
        }
        const body = validate(parsed);
        const out = provider(env) === 'anthropic' ? await completeAnthropic(env, body) : await completeOpenAiCompatible(env, body);
        return json(out);
      }

      if (req.method === 'POST' && url.pathname === '/v1/pronunciation') {
        rateLimit(env);
        return await assessPronunciation(req, env, url);
      }

      throw new HttpError(404, 'not_found', 'Rota inexistente.');
    } catch (e) {
      if (e instanceof HttpError) {
        status = e.status;
        return json({ error: { code: e.code, message: e.message } }, e.status);
      }
      status = 500;
      console.error('erro inesperado:', e instanceof Error ? e.name : 'desconhecido');
      return json({ error: { code: 'internal', message: 'Erro interno do backend.' } }, 500);
    } finally {
      // Log técnico sem conteúdo de mensagens, tokens ou áudio.
      console.log(JSON.stringify({ route: url.pathname, method: req.method, status, ms: Date.now() - started }));
    }
  },
};
