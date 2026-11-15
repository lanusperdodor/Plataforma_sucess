import { describe, expect, it, vi } from 'vitest'
import { handlePayments } from './payments'

const BIZ = '11111111-2222-3333-4444-555555555555'
const ENV = { PAYMENTS_INTEGRATION_KEY: 'k'.repeat(40) }
const res = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })
type Call = { url: string; body: Record<string, unknown> | null; method: string }

function fake(routes: Record<string, (b: Record<string, unknown> | null) => Response>) {
  const calls: Call[] = []
  const f = vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => {
    const url = String(u)
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    calls.push({ url, body, method: init?.method ?? 'GET' })
    const k = Object.keys(routes).find((x) => url.includes(x))
    if (!k) throw new Error('rede inesperada: ' + url)
    return routes[k]!(body)
  }) as unknown as typeof fetch
  return { f, calls }
}
const cfg = () => res([{ access_token: 'APP_USR-segredo', webhook_secret: null, enabled: true }])
const post = (path: string, body: unknown, token = 'a.b.c') => new Request(`https://tucai.test${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

describe('assinatura com débito automático (Mercado Pago)', () => {
  it('cria a assinatura mensal com o valor do banco e devolve o link para autorizar o cartão', async () => {
    const { f, calls } = fake({
      owner_start_subscription: () => res({ business_id: BIZ, business_name: 'Lanchonete', plan_code: 'presencial_delivery', plan_name: 'Premium', price_cents: 9900, payer_email: 'dono@exemplo.com' }),
      worker_payment_config: cfg,
      '/preapproval': () => res({ id: 'pre-1', init_point: 'https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=pre-1' }),
      worker_save_preapproval: () => res(null),
    })
    const r = await handlePayments(post('/api/pagamentos/assinatura', { business: BIZ, plan: 'presencial_delivery' }), ENV, 'https://tucai.test', f)
    expect(r!.status).toBe(200)
    expect(await r!.json()).toEqual({ url: expect.stringContaining('preapproval_id=pre-1') })
    const mp = calls.find((c) => c.url.endsWith('/preapproval'))!
    expect(mp.body).toMatchObject({ external_reference: BIZ, payer_email: 'dono@exemplo.com', auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: 99, currency_id: 'BRL' } })
    expect(calls.find((c) => c.url.includes('worker_save_preapproval'))!.body).toMatchObject({ _business: BIZ, _plan: 'presencial_delivery', _preapproval_id: 'pre-1' })
  })
  it('sem gateway ativo: avisa e não cria nada', async () => {
    const { f } = fake({
      owner_start_subscription: () => res({ business_id: BIZ, business_name: 'L', plan_code: 'delivery', plan_name: 'Padrão', price_cents: 7900, payer_email: 'a@b.c' }),
      worker_payment_config: () => res([{ access_token: null, webhook_secret: null, enabled: false }]),
    })
    expect((await handlePayments(post('/api/pagamentos/assinatura', { business: BIZ, plan: 'delivery' }), ENV, 'https://tucai.test', f))!.status).toBe(503)
  })
  it('sem permissão ou dados inválidos: recusa', async () => {
    const { f } = fake({ owner_start_subscription: () => res({ message: 'forbidden' }, 403) })
    expect((await handlePayments(post('/api/pagamentos/assinatura', { business: BIZ, plan: 'delivery' }), ENV, 'https://tucai.test', f))!.status).toBe(409)
    expect((await handlePayments(post('/api/pagamentos/assinatura', { business: 'x', plan: 'delivery' }), ENV, 'https://tucai.test', f))!.status).toBe(400)
    expect((await handlePayments(post('/api/pagamentos/assinatura', { business: BIZ, plan: 'delivery' }, ''), ENV, 'https://tucai.test', f))!.status).toBe(401)
  })
  it('aviso de assinatura: confere na API e grava a situação', async () => {
    const { f, calls } = fake({ worker_payment_config: cfg, '/preapproval/pre-1': () => res({ id: 'pre-1', status: 'authorized' }), worker_preapproval_status: () => res('autorizada') })
    const r = await handlePayments(post('/api/pagamentos/webhook', { type: 'subscription_preapproval', data: { id: 'pre-1' } }), ENV, 'https://tucai.test', f)
    expect(await r!.json()).toMatchObject({ ok: true, result: 'autorizada' })
    expect(calls.find((c) => c.url.includes('worker_preapproval_status'))!.body).toMatchObject({ _preapproval_id: 'pre-1', _status: 'authorized' })
  })
  it('mensalidade aprovada vira cobrança paga; recusada é ignorada', async () => {
    const ok = fake({ worker_payment_config: cfg, '/authorized_payments/77': () => res({ preapproval_id: 'pre-1', transaction_amount: 99, currency_id: 'BRL', payment: { id: 555, status: 'approved' } }), worker_preapproval_payment: () => res('confirmado') })
    const r = await handlePayments(post('/api/pagamentos/webhook', { type: 'subscription_authorized_payment', data: { id: '77' } }), ENV, 'https://tucai.test', ok.f)
    expect(await r!.json()).toMatchObject({ result: 'confirmado' })
    expect(ok.calls.find((c) => c.url.includes('worker_preapproval_payment'))!.body).toMatchObject({ _preapproval_id: 'pre-1', _payment_id: '555', _amount_cents: 9900 })
    const no = fake({ worker_payment_config: cfg, '/authorized_payments/78': () => res({ preapproval_id: 'pre-1', transaction_amount: 99, currency_id: 'BRL', payment: { id: 556, status: 'rejected' } }) })
    expect(await (await handlePayments(post('/api/pagamentos/webhook', { type: 'subscription_authorized_payment', data: { id: '78' } }), ENV, 'https://tucai.test', no.f))!.json()).toMatchObject({ ignored: 'rejected' })
  })
  it('cancelar: pede ao Mercado Pago e registra', async () => {
    const { f, calls } = fake({ subscription_to_cancel: () => res({ preapproval_id: 'pre-1' }), worker_payment_config: cfg, '/preapproval/pre-1': () => res({ id: 'pre-1', status: 'cancelled' }), worker_preapproval_status: () => res('cancelada') })
    const r = await handlePayments(post('/api/pagamentos/assinatura/cancelar', { business: BIZ }), ENV, 'https://tucai.test', f)
    expect(r!.status).toBe(200)
    expect(calls.find((c) => c.url.includes('/preapproval/pre-1'))).toMatchObject({ method: 'PUT', body: { status: 'cancelled' } })
  })
})
