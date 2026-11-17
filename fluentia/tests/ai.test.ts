import { describe, expect, it, vi } from 'vitest';
import { AiError, createAiClient, isValidBackendUrl, parseJsonReply, type AiDeps } from '../src/services/ai/client';
import { buildLessonFromAi, type LessonRequest } from '../src/services/ai/lessonGen';
import { buildHistory, OPENING, parseTutorTurn, parseWriting, pickWritingPrompt, tutorSystemPrompt, tutorTurn } from '../src/services/ai/tutor';
import { buildLessonExercises } from '../src/domain/exercises';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const fail = (status: number, code = '', message = '') => new Response(JSON.stringify({ error: { code, message } }), { status });
const reply = { text: '{"reply":"Hi"}', model: 'm', usage: { input: 10, output: 5 } };

function setup(over: Partial<AiDeps> = {}) {
  const logUsage = vi.fn(async () => undefined);
  const fetchMock = vi.fn();
  const deps: AiDeps = {
    getConfig: async () => ({ baseUrl: 'https://meu-backend.example/', token: 'tok' }),
    fetch: fetchMock as unknown as typeof fetch,
    requestsToday: async () => 0,
    dailyLimit: async () => 100,
    logUsage,
    sleep: async () => undefined,
    timeoutMs: 30,
    ...over,
  };
  return { ai: createAiClient(deps), fetchMock, logUsage };
}
const req = { kind: 'tutor', system: 's', messages: [{ role: 'user' as const, content: 'oi' }] };
const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof AiError ? e.code : `outro:${e}`));

describe('cliente de IA', () => {
  it('envia o token no cabeçalho, registra o uso e devolve o texto', async () => {
    const { ai, fetchMock, logUsage } = setup();
    fetchMock.mockResolvedValue(ok(reply));
    expect((await ai.complete(req)).text).toBe('{"reply":"Hi"}');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://meu-backend.example/v1/complete');
    expect(init.headers.authorization).toBe('Bearer tok');
    expect(logUsage).toHaveBeenCalledWith('tutor', 10, 5);
  });
  it('sem configuração não faz nenhuma chamada', async () => {
    const { ai, fetchMock } = setup({ getConfig: async () => null });
    expect(await code(ai.complete(req))).toBe('not_configured');
    expect(await ai.isConfigured()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('falha de conexão: tenta de novo uma vez e então informa que está offline', async () => {
    const { ai, fetchMock, logUsage } = setup();
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    expect(await code(ai.complete(req))).toBe('offline');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logUsage).not.toHaveBeenCalled();
  });
  it('recupera-se quando a segunda tentativa funciona', async () => {
    const { ai, fetchMock } = setup();
    fetchMock.mockRejectedValueOnce(new TypeError('falhou')).mockResolvedValueOnce(ok(reply));
    expect((await ai.complete(req)).model).toBe('m');
  });
  it('erro 503 do backend é tentado de novo; 400 não', async () => {
    const a = setup();
    a.fetchMock.mockResolvedValueOnce(fail(503)).mockResolvedValueOnce(ok(reply));
    expect(await code(a.ai.complete(req))).toBe('ok');
    const b = setup();
    b.fetchMock.mockResolvedValue(fail(400, 'bad_request', 'ruim'));
    expect(await code(b.ai.complete(req))).toBe('server');
    expect(b.fetchMock).toHaveBeenCalledTimes(1);
  });
  it('timeout aborta a requisição', async () => {
    const { ai, fetchMock } = setup();
    fetchMock.mockImplementation(
      (_u: string, init: RequestInit) =>
        new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    );
    expect(await code(ai.complete(req))).toBe('timeout');
  });
  it('token recusado, limites e recusa do modelo têm códigos próprios e não são repetidos', async () => {
    for (const [res, expected] of [
      [fail(401), 'unauthorized'],
      [fail(429, 'rate_limited'), 'rate_limited'],
      [fail(429, 'daily_limit'), 'daily_limit'],
      [fail(422, 'refusal'), 'refusal'],
    ] as const) {
      const { ai, fetchMock } = setup();
      fetchMock.mockResolvedValue(res);
      expect(await code(ai.complete(req))).toBe(expected);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });
  it('respeita o teto diário local sem chamar a rede', async () => {
    const { ai, fetchMock } = setup({ requestsToday: async () => 50, dailyLimit: async () => 50 });
    expect(await code(ai.complete(req))).toBe('local_daily_limit');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('resposta vazia ou ilegível vira erro, não conteúdo inventado', async () => {
    const a = setup();
    a.fetchMock.mockResolvedValue(ok({ text: '' }));
    expect(await code(a.ai.complete(req))).toBe('bad_response');
    const b = setup();
    b.fetchMock.mockResolvedValue(new Response('<html>', { status: 200 }));
    expect(await code(b.ai.complete(req))).toBe('bad_response');
  });
  it('avaliação fonética indisponível é sinalizada', async () => {
    const { ai, fetchMock } = setup();
    fetchMock.mockResolvedValue(fail(501, 'pronunciation_unavailable'));
    expect(await code(ai.pronunciation(new ArrayBuffer(4), 'en-US', 'Hello'))).toBe('unavailable');
  });
  it('só aceita URL https (ou localhost para testes)', () => {
    expect(isValidBackendUrl('https://fluentia.exemplo.workers.dev')).toBe(true);
    expect(isValidBackendUrl('http://localhost:8787')).toBe(true);
    expect(isValidBackendUrl('http://inseguro.com')).toBe(false);
    expect(isValidBackendUrl('qualquer coisa')).toBe(false);
  });
});

describe('professor virtual', () => {
  const ctx = { lang: 'zh' as const, level: 'A1' as const, scenario: 'Restaurante', known: ['你好'], weak: ['谢谢'] };
  it('o prompt leva idioma, nível, cenário, vocabulário e a regra de dar dica antes da resposta', () => {
    const p = tutorSystemPrompt(ctx);
    for (const piece of ['Mandarim', 'A1', 'Restaurante', '你好', '谢谢', 'pinyin', 'dica', 'tente de novo']) expect(p).toContain(piece);
  });
  it('interpreta acerto, dica e correção', () => {
    const base = { reply: '好！', reply_reading: 'Hǎo!', reply_pt: 'Bom!', suggestions: ['谢谢', '', 3, '再见', 'x'] };
    const good = parseTutorTurn(JSON.stringify({ ...base, feedback: { ok: true, hint: '', corrected: '', explanation: '' } }), false);
    expect(good).toMatchObject({ reply: '好！', reading: 'Hǎo!', translation: 'Bom!', feedback: { ok: true }, suggestions: ['谢谢', '再见'] });
    const hint = parseTutorTurn(JSON.stringify({ ...base, feedback: { ok: false, hint: 'Falta o classificador.', corrected: '', explanation: '' } }), false);
    expect(hint.feedback).toEqual({ ok: false, hint: 'Falta o classificador.', corrected: undefined, explanation: undefined });
    expect(parseTutorTurn(JSON.stringify({ ...base, feedback: { ok: false, hint: 'x' } }), true).feedback).toBeNull();
  });
  it('tolera cercas de código e rejeita resposta sem fala', () => {
    expect(parseJsonReply<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonReply<{ a: number }>('Claro! {"a":2} pronto')).toEqual({ a: 2 });
    expect(() => parseTutorTurn('{"reply":""}', false)).toThrow(AiError);
    expect(() => parseTutorTurn('não é json', false)).toThrow(AiError);
  });
  it('o histórico preserva o contexto e as dicas já dadas', () => {
    const h = buildHistory([
      { role: 'assistant', content: '你好！', translation: 'Olá!', feedback_json: null },
      { role: 'user', content: '我要咖啡', translation: null, feedback_json: JSON.stringify({ ok: false, hint: 'Falta 一杯.' }) },
      { role: 'assistant', content: '再试一次。', translation: 'Tente de novo.', feedback_json: null },
      { role: 'user', content: '我要一杯咖啡', translation: null, feedback_json: null },
    ]);
    expect(h.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(h[0].content).toBe(OPENING);
    expect(JSON.parse(h[3].content).feedback).toMatchObject({ ok: false, hint: 'Falta 一杯.' });
    expect(h[4].content).toBe('我要一杯咖啡');
  });
  it('histórico longo é cortado começando em fala do aluno', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ role: i % 2 ? ('user' as const) : ('assistant' as const), content: `m${i}`, translation: null, feedback_json: null }));
    const h = buildHistory(many);
    expect(h.length).toBeLessThanOrEqual(30);
    expect(h[0].role).toBe('user');
    expect(h[h.length - 1].content).toBe('m79');
  });
  it('um turno completo: chama o backend com o esquema e devolve a fala', async () => {
    const { ai, fetchMock } = setup();
    fetchMock.mockResolvedValue(ok({ text: JSON.stringify({ reply: '你好！', reply_reading: 'Nǐ hǎo!', reply_pt: 'Olá!', feedback: { ok: true }, suggestions: [] }), model: 'm', usage: { input: 1, output: 1 } }));
    const turn = await tutorTurn(ai, ctx, []);
    expect(turn).toMatchObject({ reply: '你好！', feedback: null });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.schema.required).toContain('feedback');
    expect(sent.messages).toEqual([{ role: 'user', content: OPENING }]);
  });
});

describe('correção de escrita e geração de lições', () => {
  it('interpreta a correção e descarta itens vazios', () => {
    const w = parseWriting(JSON.stringify({ corrected: 'I am 25 years old.', summary: 'Bom.', level_estimate: 'A1', strengths: ['claro'], issues: [{ category: 'gramática', original: 'I have 25 years', suggestion: 'I am 25 years old', explanation: 'Idade usa to be.' }, {}] }));
    expect(w.issues).toHaveLength(1);
    expect(w.levelEstimate).toBe('A1');
    expect(() => parseWriting('{}')).toThrow(AiError);
  });
  it('escolhe tema do nível do aluno ou do mais próximo', () => {
    expect(pickWritingPrompt('sentence', 'en', 'A1', 0)).toMatch(/Apresente-se/);
    expect(pickWritingPrompt('essay', 'en', 'A1', 0)).toMatch(/redes sociais/);
    expect(pickWritingPrompt('fix', 'es', 'A1', 1)).toBe('La mi madre es profesora.');
  });
  const lr: LessonRequest = { lang: 'zh', level: 'A1', unitId: 'zh.a1.p1', unitTitle: 'Tempo e datas', unitGoals: 'x', existing: [], known: [] };
  const item = (t: string, r: string, pt: string) => ({ t, r, pt, alt: [], ptAlt: [] });
  const gen = (nWords: number) =>
    JSON.stringify({
      title: 'Hoje e amanhã',
      objective: 'Falar de dias.',
      explanation: ['p1', 'p2', 'p3'],
      pronunciation: [],
      words: Array.from({ length: nWords }, (_, i) => item(`词${i}`, `cí${i}`, `palavra ${i}`)),
      sentences: [item('今天 很 热', 'Jīntiān hěn rè', 'Hoje está quente.'), item('明天 见', 'Míngtiān jiàn', 'Até amanhã.'), item('我 明天 去', 'Wǒ míngtiān qù', 'Eu vou amanhã.'), item('sem leitura', '', 'x')],
      scenario: 'Combine um encontro.',
    });
  it('lição gerada vira conteúdo válido e gera exercícios', () => {
    const lesson = buildLessonFromAi(gen(8), lr, 1);
    expect(lesson.id).toBe('zh.a1.p1.g1');
    expect(lesson.sentences).toHaveLength(3);
    expect(lesson.words[0].id).toBe('zh.a1.p1.g1.w1');
    expect(buildLessonExercises(lesson, 'zh', { mode: 'assessment', seed: 1, speech: false }).length).toBeGreaterThan(4);
  });
  it('lição incompleta é descartada', () => {
    expect(() => buildLessonFromAi(gen(3), lr, 1)).toThrow(/incompleta/);
  });
});
