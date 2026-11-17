import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { resetLimitsForTests, type Env } from './index';

const TOKEN = 'um-token-bem-comprido-123';
const env: Env = { APP_TOKEN: TOKEN, PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_MODEL: 'claude-opus-5-5' };

const call = (path: string, init: RequestInit = {}, e: Env = env, token: string | null = TOKEN) =>
  worker.fetch(new Request(`https://backend.test${path}`, { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } }), e);
const complete = (body: unknown, e: Env = env) => call('/v1/complete', { method: 'POST', body: JSON.stringify(body) }, e);
const anthropicReply = (over: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: '{"reply":"Hello!"}' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 120, output_tokens: 30 },
      ...over,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetLimitsForTests();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('autenticação', () => {
  it('recusa sem token, com token errado e quando o backend não tem token configurado', async () => {
    expect((await call('/v1/health', {}, env, null)).status).toBe(401);
    expect((await call('/v1/health', {}, env, 'errado')).status).toBe(401);
    expect((await call('/v1/health', {}, { ...env, APP_TOKEN: 'curto' })).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('health informa o que está configurado, sem expor segredos', async () => {
    const res = await call('/v1/health');
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ ok: true, provider: 'anthropic', model: 'claude-opus-5-5', llm: true, pronunciation: false });
    expect(body).not.toContain('sk-test');
    expect(body).not.toContain(TOKEN);
  });
});

describe('/v1/complete com Anthropic', () => {
  it('envia a chave só para o provedor e devolve texto e uso', async () => {
    fetchMock.mockResolvedValue(anthropicReply());
    const res = await complete({ system: 'Você é professor.', messages: [{ role: 'user', content: 'Hi' }], schema: { type: 'object' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: '{"reply":"Hello!"}', model: 'claude-opus-5-5', usage: { input: 120, output: 30 } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('api.anthropic.com/v1/messages');
    const h = new Headers(init.headers);
    // O SDK escolhe o cabeçalho de credencial; o que importa é que a chave do backend foi usada.
    expect(`${h.get('x-api-key') ?? ''} ${h.get('authorization') ?? ''}`).toContain('sk-test');
    const sent = JSON.parse(String(init.body));
    expect(sent.model).toBe('claude-opus-5-5');
    expect(sent.output_config).toEqual({ effort: 'low', format: { type: 'json_schema', schema: { type: 'object' } } });
    expect(sent.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(sent.fallbacks).toBe('default');
    expect(sent.thinking).toBeUndefined();
  });
  it('modelo sem suporte a fallback usa o endpoint normal, sem o parâmetro', async () => {
    fetchMock.mockResolvedValue(anthropicReply({ model: 'claude-haiku-5-5' }));
    const res = await complete({ messages: [{ role: 'user', content: 'Hi' }] }, { ...env, ANTHROPIC_MODEL: 'claude-haiku-5-5' });
    expect(res.status).toBe(200);
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(sent.model).toBe('claude-haiku-5-5');
    expect(sent.fallbacks).toBeUndefined();
  });
  it('recusa do modelo vira erro 422, não texto inventado', async () => {
    fetchMock.mockResolvedValue(anthropicReply({ stop_reason: 'refusal', content: [] }));
    const res = await complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('refusal');
  });
  it('chave inválida no provedor vira 503 claro', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401, headers: { 'content-type': 'application/json' } }));
    const res = await complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('provider_auth');
  });
  it('sem chave configurada não chama o provedor', async () => {
    const res = await complete({ messages: [{ role: 'user', content: 'x' }] }, { ...env, ANTHROPIC_API_KEY: undefined });
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('valida o corpo da requisição', async () => {
    expect((await complete({})).status).toBe(400);
    expect((await complete({ messages: [{ role: 'assistant', content: 'oi' }] })).status).toBe(400);
    expect((await complete({ messages: [{ role: 'user', content: '' }] })).status).toBe(400);
    expect((await complete({ messages: [{ role: 'user', content: 'x'.repeat(70_000) }] })).status).toBe(413);
    expect((await call('/v1/complete', { method: 'POST', body: '{nao-json' })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('limita requisições por minuto', async () => {
    fetchMock.mockImplementation(async () => anthropicReply());
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await complete({ messages: [{ role: 'user', content: 'x' }] })).status);
    expect(statuses.filter((s) => s === 200).length).toBe(20);
    expect(statuses.slice(20)).toEqual([429, 429]);
  });
  it('respeita o limite diário configurado', async () => {
    fetchMock.mockImplementation(async () => anthropicReply());
    const e = { ...env, DAILY_REQUEST_LIMIT: '2' };
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await complete({ messages: [{ role: 'user', content: 'x' }] }, e)).status);
    expect(statuses).toEqual([200, 200, 429]);
  });
});

describe('/v1/complete com provedor compatível com OpenAI', () => {
  const oa: Env = { APP_TOKEN: TOKEN, PROVIDER: 'openai-compatible', OPENAI_API_KEY: 'k', OPENAI_BASE_URL: 'https://llm.example/v1/', OPENAI_MODEL: 'modelo-x' };
  it('traduz a requisição e a resposta', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ model: 'modelo-x', choices: [{ message: { content: 'Hola' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }), { status: 200 }));
    const res = await complete({ system: 'S', messages: [{ role: 'user', content: 'Hola' }] }, oa);
    expect(await res.json()).toEqual({ text: 'Hola', model: 'modelo-x', usage: { input: 10, output: 2 } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://llm.example/v1/chat/completions');
    expect(JSON.parse(String(init.body)).messages[0]).toEqual({ role: 'system', content: 'S' });
  });
  it('cota esgotada vira 429', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 429 }));
    expect((await complete({ messages: [{ role: 'user', content: 'x' }] }, oa)).status).toBe(429);
  });
  it('falha de rede vira 504', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect((await complete({ messages: [{ role: 'user', content: 'x' }] }, oa)).status).toBe(504);
  });
});

describe('/v1/pronunciation', () => {
  it('sem Azure configurado responde 501 (não inventa nota)', async () => {
    const res = await call('/v1/pronunciation?lang=en-US&text=Hello', { method: 'POST', body: new Uint8Array([1, 2, 3]) });
    expect(res.status).toBe(501);
  });
  it('com Azure configurado repassa o áudio e normaliza as métricas', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ RecognitionStatus: 'Success', NBest: [{ Display: 'Hello.', AccuracyScore: 91, FluencyScore: 88, CompletenessScore: 100, ProsodyScore: 80, PronScore: 89, Words: [{ Word: 'hello', AccuracyScore: 91, ErrorType: 'None' }] }] }), { status: 200 })
    );
    const res = await call('/v1/pronunciation?lang=en-US&text=Hello', { method: 'POST', body: new Uint8Array([1, 2, 3]) }, { ...env, AZURE_SPEECH_KEY: 'az', AZURE_SPEECH_REGION: 'brazilsouth' });
    expect(await res.json()).toMatchObject({ accuracy: 91, fluency: 88, completeness: 100, prosody: 80, overall: 89, words: [{ word: 'hello', accuracy: 91, error: 'None' }] });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('brazilsouth.stt.speech.microsoft.com');
    const cfg = JSON.parse(atob(new Headers(init.headers).get('Pronunciation-Assessment')!));
    expect(cfg).toMatchObject({ ReferenceText: 'Hello', Granularity: 'Phoneme' });
  });
});
