// Teste de ponta a ponta NA INTERFACE (Playwright), com as contas de homologação, em um ambiente onde a
// migração 0022 foi aplicada. Abre cliente, restaurante, cozinha, entregador e Master ao mesmo tempo e
// confere que cada painel recebe a atualização SEM recarregar (tempo real).
//
// Nada de senha no repositório: tudo vem de variáveis de ambiente.
//   E2E_BASE_URL            site a testar (ex.: https://plataforma-sucess.marcossonopi.workers.dev)
//   E2E_PASSWORD            senha das contas de homologação (mostrada uma vez na aba Logins)
//   E2E_CLIENTE, E2E_DONO, E2E_COZINHA, E2E_ENTREGADOR   e-mails das contas de teste
//   E2E_RESTAURANTE_SLUG    slug do "[Teste] Lanchonete do Tuca"
//   E2E_MASTER, E2E_MASTER_PASSWORD (opcional; sem MFA ativo) para conferir o histórico no painel Master
// Sem as credenciais, roda só a etapa pública (estabelecimentos de teste não podem aparecer para visitantes).
//
// Uso:  node scripts/e2e-homologacao.mjs        Evidências: e2e-evidence/<data>/ (capturas + relatorio.json)
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const env = process.env
const base = (env.E2E_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const outDir = join('e2e-evidence', new Date().toISOString().replace(/[:.]/g, '-'))
mkdirSync(outDir, { recursive: true })
const results = []
const LIVE_MS = 30_000 // tempo máximo para a atualização chegar sem recarregar

async function step(name, fn) {
  const t0 = Date.now()
  try {
    await fn()
    results.push({ step: name, ok: true, ms: Date.now() - t0 })
    console.log(`✔ ${name}`)
  } catch (e) {
    results.push({ step: name, ok: false, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 500) })
    console.log(`✘ ${name}: ${e?.message ?? e}`)
    throw e
  }
}
const shot = (page, name) => page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true })

async function login(browser, email, password, path = '/entrar') {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(base + path)
  await page.getByLabel('E-mail ou usuário').fill(email)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: /^Entrar/ }).click()
  await page.waitForURL((u) => !u.pathname.endsWith('/entrar'), { timeout: 20_000 })
  return page
}

async function openOrdersPanel(page) {
  await page.goto(base + '/painel')
  await page.getByRole('link', { name: /Lanchonete do Tuca/ }).first().click()
  await page.getByRole('link', { name: /^Pedidos/ }).first().click()
  await page.getByRole('button', { name: 'Em andamento' }).waitFor()
}

const browser = await chromium.launch()
let code = ''
try {
  await step('Público: estabelecimentos de teste não aparecem para visitantes', async () => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(base + '/restaurantes', { waitUntil: 'networkidle' })
    await shot(page, '00-publico-restaurantes')
    const n = await page.getByText('[Teste]').count()
    if (n > 0) throw new Error(`${n} estabelecimento(s) "[Teste]" visíveis para visitante`)
    await ctx.close()
  })

  const need = ['E2E_PASSWORD', 'E2E_CLIENTE', 'E2E_DONO', 'E2E_COZINHA', 'E2E_ENTREGADOR', 'E2E_RESTAURANTE_SLUG'].filter((k) => !env[k])
  if (need.length) {
    console.log(`\nEtapas com login puladas: defina ${need.join(', ')}.`)
  } else {
    const pw = env.E2E_PASSWORD
    let cliente, dono, cozinha, entregador, master
    await step('1. Login real (Supabase Auth) de cliente, restaurante, cozinha e entregador', async () => {
      ;[cliente, dono, cozinha, entregador] = await Promise.all([
        login(browser, env.E2E_CLIENTE, pw), login(browser, env.E2E_DONO, pw), login(browser, env.E2E_COZINHA, pw), login(browser, env.E2E_ENTREGADOR, pw),
      ])
      if (env.E2E_MASTER && env.E2E_MASTER_PASSWORD) master = await login(browser, env.E2E_MASTER, env.E2E_MASTER_PASSWORD, '/admin/entrar')
    })
    await step('Painéis abertos antes do pedido (restaurante, cozinha) e entregador disponível', async () => {
      await Promise.all([openOrdersPanel(dono), openOrdersPanel(cozinha)])
      await entregador.goto(base + '/entregador')
      const on = entregador.getByRole('button', { name: 'Ficar disponível' })
      if (await on.isVisible().catch(() => false)) await on.click()
      await entregador.getByText('Disponível para entregas').waitFor()
    })
    await step('2-4. Cliente escolhe o restaurante, adiciona dois produtos e faz o pedido', async () => {
      await cliente.goto(`${base}/restaurantes/${env.E2E_RESTAURANTE_SLUG}`)
      await cliente.getByRole('button', { name: 'Adicionar X-Burger' }).click()
      await cliente.getByLabel('Ao ponto').check()
      await cliente.getByLabel('Bacon').check()
      await cliente.getByRole('button', { name: /^Adicionar/ }).last().click()
      await cliente.getByRole('button', { name: 'Fechar' }).click()
      await cliente.getByRole('button', { name: 'Adicionar X-Salada' }).click()
      await cliente.getByRole('button', { name: /^Adicionar/ }).last().click()
      await cliente.getByRole('button', { name: 'Fechar' }).click()
      await cliente.goto(base + '/sacola')
      await shot(cliente, '01-sacola')
      await cliente.getByRole('link', { name: 'Continuar' }).click()
      await cliente.getByLabel('Nome').fill('Cliente Teste Um')
      await cliente.getByLabel('Telefone / WhatsApp').fill('(35) 99999-0000')
      await cliente.getByLabel('Endereço (rua, número, bairro)').fill('Rua das Flores, 100, Centro')
      await shot(cliente, '02-checkout')
      await cliente.getByRole('button', { name: 'Fazer pedido' }).click()
      await cliente.waitForURL(/\/pedidos\/[0-9a-f-]{36}/, { timeout: 20_000 })
      code = ((await cliente.getByRole('heading', { name: /Pedido #/ }).first().textContent()) ?? '').replace(/.*#/, '').trim()
      if (!code) throw new Error('código do pedido não encontrado')
      await shot(cliente, '03-pedido-feito')
    })
    await step('5. Restaurante recebe o pedido sem recarregar', async () => {
      await dono.getByText(`#${code}`).first().waitFor({ timeout: LIVE_MS })
      await shot(dono, '04-restaurante-recebeu')
    })
    await step('6. Restaurante confirma com tempo de preparo', async () => {
      await dono.getByLabel('Preparo').first().selectOption('20')
      await dono.getByRole('button', { name: 'Aceitar' }).first().click()
      await cliente.getByText('Previsão do estabelecimento').waitFor({ timeout: LIVE_MS })
    })
    await step('7-8. Cozinha recebe, prepara e disponibiliza para coleta', async () => {
      await cozinha.getByRole('button', { name: 'Iniciar preparo' }).first().waitFor({ timeout: LIVE_MS })
      await cozinha.getByRole('button', { name: 'Iniciar preparo' }).first().click()
      await cozinha.getByRole('button', { name: 'Marcar pronto' }).first().click()
      await shot(cozinha, '05-cozinha-pronto')
    })
    await step('9-10. Entregador recebe a oferta e aceita', async () => {
      await entregador.getByRole('button', { name: 'Aceitar' }).first().waitFor({ timeout: LIVE_MS })
      await shot(entregador, '06-oferta')
      await entregador.getByRole('button', { name: 'Aceitar' }).first().click()
      await entregador.getByText(`#${code}`).first().waitFor()
    })
    await step('11. Entregador coleta e o cliente vê "saiu para entrega"', async () => {
      await entregador.getByRole('button', { name: 'Peguei o pedido' }).click()
      await cliente.getByText('Código de entrega').waitFor({ timeout: LIVE_MS })
    })
    await step('12-13. Entregador conclui com o código do cliente; cliente vê entregue', async () => {
      const txt = (await cliente.getByText('Código de entrega').textContent()) ?? ''
      const pin = txt.replace(/\D/g, '').slice(-4)
      await entregador.getByLabel('Código do cliente').fill(pin)
      await entregador.getByRole('button', { name: 'Confirmar entrega' }).click()
      await cliente.getByRole('heading', { name: 'Entregue' }).waitFor({ timeout: LIVE_MS })
      await shot(cliente, '07-cliente-entregue')
    })
    await step('Estado recuperado ao recarregar a página', async () => {
      await cliente.reload()
      await cliente.getByRole('heading', { name: 'Entregue' }).waitFor()
    })
    if (master) {
      await step('14. Master vê o histórico completo', async () => {
        await master.goto(base + '/admin/pedidos')
        await master.getByRole('radio', { name: 'Concluídos' }).click()
        await master.getByRole('button', { name: new RegExp(`#${code}`) }).click()
        await master.getByText('Comissão Tucaí').waitFor()
        await shot(master, '08-master-historico')
      })
    }
  }
} catch {
  // o passo que falhou já foi registrado
} finally {
  await browser.close()
  const report = { base, code, when: new Date().toISOString(), passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results }
  writeFileSync(join(outDir, 'relatorio.json'), JSON.stringify(report, null, 2))
  console.log(`\nEvidências em ${outDir} — ${report.passed} ok, ${report.failed} falha(s).`)
  process.exitCode = report.failed ? 1 : 0
}
