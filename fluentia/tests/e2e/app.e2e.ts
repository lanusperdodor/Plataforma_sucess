/**
 * Fluxo completo no app (versão web, Chromium): boas-vindas → lição com prática e avaliação →
 * progresso independente por idioma → revisão FSRS → professor de IA (backend simulado) →
 * estatísticas → backup, apagar tudo e restaurar → persistência após recarregar.
 *
 * Rode antes: `npx expo export --platform web` e `node tests/e2e/serve.mjs`.
 *
 * O robô resolve os exercícios como um aluno: lê o enunciado e "ouve" o áudio (interceptando a
 * síntese de voz do navegador), e procura a resposta no currículo.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CURRICULUM, display, type Item, type LangCode, type LessonContent } from '../../src/content';

const URL = process.env.FLUENTIA_URL ?? 'http://localhost:8082';
const SHOTS = process.env.FLUENTIA_SHOTS;
const MOCK = 'https://backend-simulado.test';

let browser: Browser;
let page: Page;
const pageErrors: string[] = [];
const aiRequests: { path: string; body: unknown; auth: string | null }[] = [];

const tid = (id: string) => page.getByTestId(id);
const shot = async (name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
async function lastSpoken(): Promise<string> {
  return page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.at(-1) ?? '');
}

function lessonById(id: string): { lang: LangCode; lesson: LessonContent } {
  for (const lang of Object.keys(CURRICULUM) as LangCode[]) {
    for (const c of CURRICULUM[lang]) for (const u of c.units) for (const l of u.lessons) if (l.id === id) return { lang, lesson: l };
  }
  throw new Error(`lição ${id} não encontrada`);
}

/** Resolve o exercício na tela. `wrong` responde errado de propósito (quando possível). */
async function solveOne(lang: LangCode, lesson: LessonContent, wrong = false): Promise<string> {
  const items: Item[] = [...lesson.words, ...lesson.sentences];
  const instruction = ((await tid('instrucao').textContent()) ?? '').trim();
  const promptBox = tid('enunciado');
  const prompt = (await promptBox.count()) ? ((await promptBox.locator('div[dir="auto"]').first().textContent()) ?? '').trim() : '';
  const byTarget = (t: string) => items.find((i) => display(lang, i.t) === t || (i.alt ?? []).map((a) => display(lang, a)).includes(t));
  const byPt = (pt: string) => items.find((i) => i.pt === pt);
  const clickOption = async (text: string) => {
    const opts = page.locator('[role="radio"]');
    const n = await opts.count();
    const texts = await Promise.all(Array.from({ length: n }, (_, k) => opts.nth(k).innerText()));
    const idx = wrong ? texts.findIndex((t) => t.trim() !== text) : texts.findIndex((t) => t.trim() === text);
    if (idx < 0) throw new Error(`opção "${text}" não encontrada em ${JSON.stringify(texts)}`);
    await opts.nth(idx).click();
  };
  const type = async (text: string) => tid('resposta').fill(wrong ? 'xyz' : text);

  if (/repita em voz alta/.test(instruction)) {
    // Sem microfone no navegador de teste: pula (não entra na nota).
    await page.getByText('Não posso falar agora', { exact: false }).click();
    return 'speak';
  }
  if (/identifique o tom/.test(instruction)) {
    const spoken = await lastSpoken();
    const tone = lesson.tones!.find((t) => t.hanzi === spoken)!;
    const opts = page.locator('[role="radio"]');
    await opts.nth(wrong ? (tone.tone % 4) : tone.tone - 1).click();
  } else if (/^Ouça e escolha o significado|^Ouça\. Que som/.test(instruction)) {
    await clickOption(byTarget(await lastSpoken())!.pt);
  } else if (/identifique o que foi dito/.test(instruction)) {
    await clickOption(await lastSpoken());
  } else if (/escreva o que ouviu/.test(instruction)) {
    await type(await lastSpoken());
  } else if (/^O que significa|^Que som é este/.test(instruction)) {
    await clickOption(byTarget(prompt)!.pt);
  } else if (/^Como se diz|^Qual é a letra/.test(instruction)) {
    await clickOption(display(lang, byPt(prompt)!.t));
  } else if (/Monte a frase/.test(instruction)) {
    const words = byPt(prompt)!.t.split(' ');
    for (const w of wrong ? [...words].reverse() : words) {
      const pieces = tid(`peca-${w}`);
      const n = await pieces.count();
      for (let k = 0; k < n; k++) {
        if (await pieces.nth(k).isEnabled()) {
          await pieces.nth(k).click();
          break;
        }
      }
    }
  } else if (/Complete a frase/.test(instruction)) {
    const sentences = lesson.sentences;
    let answer = '';
    for (const s of sentences) {
      const ws = s.t.split(' ');
      for (let k = 0; k < ws.length; k++) {
        const clean = ws[k].replace(/[.,!?¿¡。？！，]/g, '');
        if (!clean) continue;
        const blanked = ws.map((w, j) => (j === k ? w.replace(clean, '____') : w)).join(' ');
        if ((lang === 'zh' ? blanked.replace(/ /g, '') : blanked) === prompt) answer = clean;
      }
    }
    await clickOption(answer);
  } else if (/^Escreva em português/.test(instruction)) {
    await type(byTarget(prompt)!.pt);
  } else if (/^Escreva em/.test(instruction)) {
    await type(byPt(prompt)!.t);
  } else {
    throw new Error(`tipo de exercício desconhecido: ${instruction}`);
  }
  await tid('verificar').click();
  return instruction;
}

/** Percorre uma sessão inteira; `wrongAt` são os índices respondidos errado. */
async function runSession(lessonId: string, wrongAt: number[] = []): Promise<{ results: string[] }> {
  const { lang, lesson } = lessonById(lessonId);
  const results: string[] = [];
  for (let n = 0; n < 80; n++) {
    await tid('instrucao').waitFor({ timeout: 15000 });
    await page.waitForTimeout(250);
    const kind = await solveOne(lang, lesson, wrongAt.includes(n));
    if (kind !== 'speak') results.push(((await tid('resultado').textContent()) ?? '').trim());
    const done = ((await tid('continuar').textContent()) ?? '').includes('Concluir');
    await tid('continuar').click();
    if (done) break;
  }
  return { results };
}

beforeAll(async () => {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, acceptDownloads: true });
  await ctx.addInitScript(() => {
    const w = window as unknown as { __spoken: string[] };
    w.__spoken = [];
    // Captura o que o app manda falar e encerra a fala na hora (o navegador de teste não tem vozes).
    const synth = window.speechSynthesis;
    if (synth) {
      synth.speak = (u: SpeechSynthesisUtterance) => {
        w.__spoken.push(u.text);
        setTimeout(() => u.onend?.(new Event('end') as SpeechSynthesisEvent), 10);
      };
    }
  });
  // Backend de IA simulado: testa a integração do app sem chave real nem custo.
  await ctx.route(`${MOCK}/**`, async (route) => {
    const req = route.request();
    const path = new globalThis.URL(req.url()).pathname;
    aiRequests.push({ path, body: req.postDataJSON?.() ?? null, auth: req.headers()['authorization'] ?? null });
    if (path === '/v1/health') return route.fulfill({ json: { ok: true, provider: 'anthropic', model: 'claude-opus-5-5', llm: true, pronunciation: false } });
    if (path === '/v1/complete') {
      const body = req.postDataJSON() as { messages: { role: string; content: string }[] };
      const last = body.messages.at(-1)!.content;
      const opening = body.messages.length === 1;
      const wrong = /I has/.test(last);
      const reply = {
        reply: opening ? 'Hello! What is your name?' : wrong ? 'Almost! Try again.' : 'Nice to meet you!',
        reply_reading: '',
        reply_pt: opening ? 'Olá! Qual é o seu nome?' : wrong ? 'Quase! Tente de novo.' : 'Prazer em conhecer você!',
        feedback: wrong ? { ok: false, hint: 'Confira o verbo depois de "I".', corrected: '', explanation: '' } : { ok: true, hint: '', corrected: '', explanation: '' },
        suggestions: opening ? ['My name is Ana.'] : [],
      };
      return route.fulfill({ json: { text: JSON.stringify(reply), model: 'claude-opus-5-5', usage: { input: 900, output: 60 } } });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'x' } } });
  });
  page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 120000 });
});

afterAll(async () => {
  await browser?.close();
});

describe('Fluentia — fluxo completo', () => {
  it('boas-vindas e dashboard', async () => {
    await tid('nome').fill('Marcos');
    await tid('inicio-en').click();
    await shot('01-boas-vindas');
    await tid('comecar').click();
    await expect.poll(() => tid('saudacao').innerText()).toBe('Marcos');
    expect(await tid('nivel-atual').innerText()).toBe('Nível A1');
    expect(await tid('sequencia').innerText()).toBe('0');
    await shot('02-inicio');
  });

  it('lição: prática completa com correção', async () => {
    await tid('continuar-estudando').click();
    await page.getByText('Objetivo').waitFor();
    await shot('03-licao');
    await tid('comecar-pratica').click();
    await tid('instrucao').waitFor();
    await shot('04-exercicio');
    // Erra o primeiro de propósito: deve aparecer como incorreto e voltar como reforço no fim.
    const { results } = await runSession('en.a1.u1.l1', [0]);
    expect(results[0]).toBe('Resposta incorreta');
    expect(results.slice(1).every((r) => r.startsWith('Correto') || r.startsWith('Certo'))).toBe(true);
    expect(results.length).toBeGreaterThan(10);
    await tid('fazer-avaliacao').waitFor();
  });

  it('avaliação abaixo de 70% não conclui a lição', async () => {
    await tid('fazer-avaliacao').click();
    await runSession('en.a1.u1.l1', Array.from({ length: 30 }, (_, i) => i));
    expect(await tid('resultado-avaliacao').innerText()).toBe('Ainda não foi desta vez');
  });

  it('avaliação aprovada conclui a lição e libera o vocabulário para revisão', async () => {
    await page.getByText('Tentar a avaliação de novo').click();
    await runSession('en.a1.u1.l1');
    expect(await tid('resultado-avaliacao').innerText()).toBe('Lição concluída!');
    await shot('05-resultado');
    await page.getByRole('button', { name: 'Voltar', exact: true }).last().click();
    await tid('saudacao').waitFor();
  });

  it('progresso independente por idioma', async () => {
    await page.getByRole('tab', { name: 'Início' }).click();
    await expect.poll(() => page.getByText('aulas concluídas').locator('..').innerText()).toContain('1/9');
    await tid('idioma-ko').click();
    await expect.poll(() => page.getByText('aulas concluídas').locator('..').innerText()).toContain('0/9');
    expect(await tid('nivel-atual').innerText()).toBe('Nível A1');
    await shot('06-coreano');
    await tid('idioma-en').click();
    await expect.poll(() => page.getByText('aulas concluídas').locator('..').innerText()).toContain('1/9');
  });

  it('revisão espaçada (FSRS)', async () => {
    await page.getByRole('tab', { name: 'Revisar' }).click();
    const n = enCount();
    await expect.poll(() => tid('revisoes-pendentes').innerText()).toBe(`${n} itens para revisar`);
    await tid('iniciar-revisao').click();
    for (let k = 0; k < 3; k++) {
      await tid('mostrar-resposta').click();
      await tid(k === 0 ? 'nota-Errei' : 'nota-Fácil').click();
    }
    await shot('07-revisao');
    await tid('voltar').click();
    // 2 cartões saíram da fila; o que recebeu "Errei" volta em minutos, mas não imediatamente.
    await expect.poll(() => tid('revisoes-pendentes').innerText()).toBe(`${n - 3} itens para revisar`);
  });

  it('professor de IA: sem configuração avisa; com backend responde e corrige', async () => {
    await page.getByRole('tab', { name: 'Conversar' }).click();
    await page.getByText('ainda não está configurado').waitFor();
    await page.getByText('Configurar agora').click();
    await tid('url-backend').fill(MOCK);
    await tid('token-backend').fill('token-pessoal-de-teste-1234');
    await tid('salvar-ia').click();
    await page.getByText('Conectado. Provedor: anthropic').waitFor();
    await tid('voltar').click();
    await tid('cenario-intro').click();
    await page.getByText('Hello! What is your name?').waitFor();
    await page.getByText('Traduzir').first().click();
    await page.getByText('Olá! Qual é o seu nome?').waitFor();
    await tid('mensagem').fill('I has a dog');
    await tid('enviar').click();
    await page.getByText('Confira o verbo depois de "I".').waitFor();
    await tid('mensagem').fill('My name is Marcos');
    await tid('enviar').click();
    await page.getByText('Nice to meet you!').waitFor();
    await shot('08-conversa');
    const complete = aiRequests.filter((r) => r.path === '/v1/complete');
    expect(complete).toHaveLength(3);
    expect(complete.every((r) => r.auth === 'Bearer token-pessoal-de-teste-1234')).toBe(true);
    const last = complete[2].body as { system: string; messages: { content: string }[]; schema: object };
    expect(last.system).toContain('Inglês');
    expect(last.system).toContain('Marcos');
    expect(last.messages.at(-1)!.content).toBe('My name is Marcos');
    expect(last.schema).toBeTruthy();
    await tid('revisar-correcoes').click();
    await page.getByText('Correções desta conversa').waitFor();
    await page.getByText('I has a dog').waitFor();
    await tid('revisar-correcoes').click();
    await tid('voltar').click();
  });

  it('estatísticas e perfil', async () => {
    await page.getByRole('tab', { name: 'Perfil' }).click();
    await tid('link-estatisticas').click();
    await tid('grafico-tempo').waitFor();
    await shot('09-estatisticas');
    await tid('voltar').click();
  });

  it('backup, apagar tudo e restaurar', async () => {
    await tid('link-dados').click();
    const [download] = await Promise.all([page.waitForEvent('download'), tid('exportar').click()]);
    const file = await download.path();
    expect(download.suggestedFilename()).toMatch(/^fluentia-backup-\d{4}-\d{2}-\d{2}\.json$/);
    await tid('apagar-tudo').click();
    await page.getByText('Dados apagados.', { exact: false }).waitFor({ state: 'attached' });
    await tid('voltar').click();
    await tid('link-dados').waitFor();
    await page.waitForTimeout(500);
    await page.getByRole('tab', { name: 'Início' }).click();
    await expect.poll(() => page.getByRole('tab', { name: 'Início' }).getAttribute('aria-selected')).toBe('true');
    await tid('nome').waitFor();
    await tid('nome').fill('Outra pessoa');
    await tid('comecar').click();
    await page.waitForTimeout(800);
    await expect.poll(() => page.getByText('aulas concluídas').locator('..').innerText()).toContain('0/9');

    await page.getByRole('tab', { name: 'Perfil' }).click();
    await tid('link-dados').click();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), tid('importar').click()]);
    await chooser.setFiles(file!);
    await tid('confirmar-restauracao').click();
    await page.getByText('Backup restaurado.').waitFor({ state: 'attached' });
    await tid('voltar').click();
    await tid('link-dados').waitFor();
    await page.waitForTimeout(500);
    await page.getByRole('tab', { name: 'Início' }).click();
    await expect.poll(() => tid('saudacao').innerText()).toBe('Marcos');
    await expect.poll(() => page.getByText('aulas concluídas').locator('..').innerText()).toContain('1/9');
  });

  it('dados persistem ao recarregar o app', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await expect.poll(() => tid('saudacao').innerText(), { timeout: 30000 }).toBe('Marcos');
    await expect.poll(() => page.getByText('aulas concluídas').locator('..').innerText()).toContain('1/9');
  });

  it('nenhum erro de execução na página', () => {
    expect(pageErrors).toEqual([]);
  });
});

function enCount(): number {
  const l = CURRICULUM.en[0].units[0].lessons[0];
  return l.words.length + l.sentences.length;
}
