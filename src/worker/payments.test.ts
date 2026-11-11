import { describe, expect, it, vi } from 'vitest'
import { handlePayments, paymentMethod, validSignature } from './payments'

const SITE = 'https://tucai.example'
const env = { PAYMENTS_INTEGRATION_KEY: 'tucai_pay_' + 'a'.repeat(64), SUPABASE_URL: 'https://db.example', SUPABASE_PUBLISHABLE_KEY: 'pub' }
const CHARGE = '11111111-2222-3333-4444-555555555555'
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function fakeFetch(overrides: Record<string, (init: RequestInit) => Response> = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const f = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    calls.push({ url, init })
    for (const [k, h] of Object.entries(overrides)) if (url.includes(k)) return h(init)
    if (url.endsWith('/rpc/worker_payment_config')) return ok([{ access_token: 'TEST-token', webhook_secret: null, enabled: true }])
    if (url.endsWith('/rpc/payable_charge')) return ok([{ id: CHARGE, business_id: 'b1', business_name: 'Loja P', description: 'Mensalidade Delivery', amount_cents: 7900 }])
    if (url.endsWith('/checkout/preferences')) return ok({ init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=1' })
    if (url.includes('/v1/payments/')) return ok({ status: 'approved', transaction_amount: 79, currency_id: 'BRL', external_reference: CHARGE, payment_method_id: 'pix', payment_type_id: 'bank_transfer' })
    if (url.endsWith('/rpc/worker_confirm_payment')) return ok('confirmado')
    if (url.endsWith('/users/me')) return ok({ nickname: 'TUCAI', site_id: 'MLB' })
    if (url.endsWith('/rpc/admin_payment_gateway_get')) return ok([{}])
    return ok({}, 404)
  })
  return { f: f as unknown as typeof fetch, calls }
}

describe('checkout', () => {
  it('cria o link com o valor da cobrança, referência e aviso no servidor; token nunca sai', async () => {
    const { f, calls } = fakeFetch()
    const res = await handlePayments(new Request(SITE + '/api/pagamentos/checkout', { method: 'POST', headers: { Authorization: 'Bearer jwt-do-lojista' }, body: JSON.stringify({ chargeId: CHARGE }) }), env, SITE, f)
    const body = (await res!.json()) as { url: string }
    expect(body.url).toContain('mercadopago.com.br')
    expect(JSON.stringify(body)).not.toContain('TEST-token')
    const charge = calls.find((c) => c.url.endsWith('/rpc/payable_charge'))!
    expect((charge.init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-do-lojista') // permissão checada como o próprio usuário
    const pref = JSON.parse(String(calls.find((c) => c.url.endsWith('/checkout/preferences'))!.init.body))
    expect(pref).toMatchObject({ external_reference: CHARGE, notification_url: SITE + '/api/pagamentos/webhook', items: [{ unit_price: 79, currency_id: 'BRL', quantity: 1 }] })
    expect(pref.back_urls.success).toBe(SITE + '/painel/b1/plano?pagamento=aprovado')
  })
  it('sem login, sem permissão ou gateway desligado: não cria pagamento', async () => {
    const req = (h: Record<string, string> = {}) => new Request(SITE + '/api/pagamentos/checkout', { method: 'POST', headers: h, body: JSON.stringify({ chargeId: CHARGE }) })
    expect((await handlePayments(req(), env, SITE, fakeFetch().f))!.status).toBe(401)
    expect((await handlePayments(req({ Authorization: 'Bearer x' }), env, SITE, fakeFetch({ '/rpc/payable_charge': () => ok([]) }).f))!.status).toBe(404)
    expect((await handlePayments(req({ Authorization: 'Bearer x' }), env, SITE, fakeFetch({ '/rpc/worker_payment_config': () => ok([{ access_token: 'TEST-t', webhook_secret: null, enabled: false }]) }).f))!.status).toBe(503)
    expect((await handlePayments(req({ Authorization: 'Bearer x' }), { ...env, PAYMENTS_INTEGRATION_KEY: '' }, SITE, fakeFetch().f))!.status).toBe(503)
  })
})

describe('aviso do Mercado Pago', () => {
  const notify = (headers: Record<string, string> = {}) =>
    new Request(SITE + '/api/pagamentos/webhook?data.id=123&type=payment', { method: 'POST', headers, body: JSON.stringify({ type: 'payment', data: { id: '123' } }) })
  it('confere o pagamento na API e dá baixa com valor em centavos e forma de pagamento', async () => {
    const { f, calls } = fakeFetch()
    const res = await handlePayments(notify(), env, SITE, f)
    expect(await res!.json()).toEqual({ ok: true, result: 'confirmado' })
    const confirm = JSON.parse(String(calls.find((c) => c.url.endsWith('/rpc/worker_confirm_payment'))!.init.body))
    expect(confirm).toEqual({ _key: env.PAYMENTS_INTEGRATION_KEY, _charge: CHARGE, _payment_id: '123', _amount_cents: 7900, _method: 'pix' })
  })
  it('pagamento não aprovado ou de outra moeda é ignorado', async () => {
    for (const p of [{ status: 'pending' }, { status: 'approved', currency_id: 'USD', external_reference: CHARGE }]) {
      const { f, calls } = fakeFetch({ '/v1/payments/': () => ok(p) })
      await handlePayments(notify(), env, SITE, f)
      expect(calls.some((c) => c.url.endsWith('/rpc/worker_confirm_payment'))).toBe(false)
    }
  })
  it('com segredo configurado, aviso sem assinatura válida é recusado', async () => {
    const { f } = fakeFetch({ '/rpc/worker_payment_config': () => ok([{ access_token: 'TEST-t', webhook_secret: 'segredo-123456789', enabled: true }]) })
    expect((await handlePayments(notify({ 'x-signature': 'ts=1,v1=abc' }), env, SITE, f))!.status).toBe(401)
  })
  it('banco fora do ar: responde erro para o Mercado Pago tentar de novo', async () => {
    const { f } = fakeFetch({ '/rpc/worker_payment_config': () => ok({}, 500) })
    expect((await handlePayments(notify(), env, SITE, f))!.status).toBe(503)
  })
})

describe('auxiliares', () => {
  it('forma de pagamento', () => {
    expect(paymentMethod({ payment_method_id: 'pix' })).toBe('pix')
    expect(paymentMethod({ payment_type_id: 'credit_card' })).toBe('cartao')
    expect(paymentMethod({ payment_type_id: 'ticket' })).toBe('boleto')
  })
  it('assinatura HMAC do Mercado Pago', async () => {
    const secret = 'segredo-123456789'
    const manifest = 'id:123;request-id:req-1;ts:1700;'
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const v1 = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest)))].map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(await validSignature(secret, `ts=1700,v1=${v1}`, 'req-1', '123')).toBe(true)
    expect(await validSignature(secret, `ts=1701,v1=${v1}`, 'req-1', '123')).toBe(false)
  })
  it('outras rotas não são tratadas aqui', async () => {
    expect(await handlePayments(new Request(SITE + '/restaurantes'), env, SITE, fakeFetch().f)).toBeNull()
  })
})
