/**
 * Cliente do backend pessoal de IA. O app nunca fala direto com o provedor nem guarda chaves de provedor:
 * só conhece a URL do backend e um token pessoal (guardado no armazenamento seguro do aparelho).
 */
export interface AiConfig {
  baseUrl: string;
  token: string;
}

export type AiErrorCode =
  | 'not_configured'
  | 'offline'
  | 'timeout'
  | 'unauthorized'
  | 'rate_limited'
  | 'daily_limit'
  | 'local_daily_limit'
  | 'refusal'
  | 'bad_response'
  | 'unavailable'
  | 'server';

export class AiError extends Error {
  constructor(
    public code: AiErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompleteRequest {
  /** Rótulo para o registro de uso: 'tutor', 'writing', 'lesson'. */
  kind: string;
  system: string;
  messages: ChatMessage[];
  schema?: Record<string, unknown>;
  maxTokens?: number;
}

export interface CompleteResult {
  text: string;
  model: string;
  usage: { input: number; output: number };
}

export interface HealthResult {
  ok: boolean;
  provider: string;
  model: string | null;
  llm: boolean;
  pronunciation: boolean;
}

export interface AiDeps {
  getConfig(): Promise<AiConfig | null>;
  fetch: typeof fetch;
  /** Quantas requisições de IA o app já fez hoje. */
  requestsToday(): Promise<number>;
  /** Teto diário definido pelo usuário no app (controle de custo local). */
  dailyLimit(): Promise<number>;
  logUsage(kind: string, input: number, output: number): Promise<void>;
  timeoutMs?: number;
  /** Espera entre tentativas; injetável para testes. */
  sleep?(ms: number): Promise<void>;
}

const DEFAULT_TIMEOUT = 75_000;
const RETRY_STATUS = new Set([502, 503, 504]);

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function isValidBackendUrl(url: string): boolean {
  // HTTPS obrigatório (o token trafega no cabeçalho); http só para testes locais.
  return /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(url.trim()) || /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?(\/[^\s]*)?$/.test(url.trim());
}

export function createAiClient(deps: AiDeps) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function config(): Promise<AiConfig> {
    const c = await deps.getConfig();
    if (!c || !c.baseUrl || !c.token) throw new AiError('not_configured', 'O professor de IA ainda não foi configurado. Abra Perfil → Inteligência artificial.');
    return { baseUrl: normalizeBaseUrl(c.baseUrl), token: c.token };
  }

  async function request(path: string, init: RequestInit, attempts: number): Promise<Response> {
    const c = await config();
    let lastError: AiError = new AiError('server', 'Falha desconhecida.');
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(800 * attempt);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT);
      let res: Response;
      try {
        res = await deps.fetch(`${c.baseUrl}${path}`, {
          ...init,
          headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${c.token}` },
          signal: controller.signal,
        });
      } catch (e) {
        // Falha de rede ou timeout: vale tentar de novo.
        lastError =
          (e as Error)?.name === 'AbortError'
            ? new AiError('timeout', 'O professor demorou demais para responder. Tente de novo.')
            : new AiError('offline', 'Sem conexão com o backend de IA. Verifique a internet.');
        clearTimeout(timer);
        continue;
      }
      try {
        if (res.ok) return res;
        let code = '';
        let message = '';
        try {
          const body = (await res.json()) as { error?: { code?: string; message?: string } };
          code = body.error?.code ?? '';
          message = body.error?.message ?? '';
        } catch {
          // corpo não-JSON: segue só com o status
        }
        if (res.status === 401) throw new AiError('unauthorized', 'O backend recusou o token. Confira o token em Perfil → Inteligência artificial.');
        if (res.status === 429) {
          throw new AiError(code === 'daily_limit' ? 'daily_limit' : 'rate_limited', message || 'Limite de requisições atingido. Tente mais tarde.');
        }
        if (res.status === 422 && code === 'refusal') throw new AiError('refusal', message || 'O modelo recusou esta solicitação.');
        if (res.status === 501) throw new AiError('unavailable', message || 'Recurso não configurado no backend.');
        lastError = new AiError('server', message || `O backend respondeu com erro ${res.status}.`);
        // Só erros transitórios do backend (502/503/504) são repetidos.
        if (!RETRY_STATUS.has(res.status)) throw lastError;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }

  return {
    async isConfigured(): Promise<boolean> {
      const c = await deps.getConfig();
      return !!(c && c.baseUrl && c.token);
    },

    async health(): Promise<HealthResult> {
      const res = await request('/v1/health', { method: 'GET' }, 1);
      return (await res.json()) as HealthResult;
    },

    async complete(req: CompleteRequest): Promise<CompleteResult> {
      await config();
      const [used, limit] = await Promise.all([deps.requestsToday(), deps.dailyLimit()]);
      if (used >= limit) {
        throw new AiError('local_daily_limit', `Você atingiu o seu limite de ${limit} requisições de IA por dia. Aumente em Perfil → Inteligência artificial ou continue amanhã.`);
      }
      const res = await request(
        '/v1/complete',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ system: req.system, messages: req.messages, schema: req.schema, maxTokens: req.maxTokens }),
        },
        2
      );
      let data: CompleteResult;
      try {
        data = (await res.json()) as CompleteResult;
      } catch {
        throw new AiError('bad_response', 'O backend devolveu uma resposta ilegível.');
      }
      if (!data || typeof data.text !== 'string' || !data.text) throw new AiError('bad_response', 'O backend devolveu uma resposta vazia.');
      await deps.logUsage(req.kind, data.usage?.input ?? 0, data.usage?.output ?? 0);
      return data;
    },

    /** Avaliação fonética real (quando o backend tem o serviço configurado). */
    async pronunciation(audio: Blob | ArrayBuffer, locale: string, text: string): Promise<PronunciationScores> {
      const res = await request(
        `/v1/pronunciation?lang=${encodeURIComponent(locale)}&text=${encodeURIComponent(text)}`,
        { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: audio as BodyInit },
        1
      );
      return (await res.json()) as PronunciationScores;
    },
  };
}

export interface PronunciationScores {
  provider: string;
  recognized: string;
  accuracy: number;
  fluency: number | null;
  completeness: number | null;
  prosody: number | null;
  overall: number | null;
  words: { word: string; accuracy: number | null; error: string }[];
}

export type AiClient = ReturnType<typeof createAiClient>;

/** Extrai o objeto JSON de uma resposta do modelo (tolera cercas de código e texto ao redor). */
export function parseJsonReply<T>(text: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        // cai no erro abaixo
      }
    }
    throw new AiError('bad_response', 'O professor respondeu em um formato inesperado. Tente de novo.');
  }
}
