/**
 * Pagamentos com Mercado Pago (Checkout Pro), no servidor:
 *  POST /api/pagamentos/checkout  → cria o link de pagamento de uma cobrança (lojista dono ou Master)
 *  POST /api/pagamentos/webhook   → aviso do Mercado Pago; confere o pagamento na API e dá baixa
 *  GET  /api/pagamentos/status    → Master testa a conexão com a conta do Mercado Pago
 *  POST /api/pagamentos/assinatura          → dono escolhe o plano: cria a assinatura com débito automático (preapproval)
 *  POST /api/pagamentos/assinatura/cancelar → dono ou Master cancela a assinatura no Mercado Pago
 * O Access Token nunca vai ao navegador: o Worker busca no banco com a chave de integração
 * (segredo PAYMENTS_INTEGRATION_KEY no Cloudflare).
 */
import { SUPABASE_PUBLIC } from '../config/supabase-public'

export interface PaymentsEnv {
  PAYMENTS_INTEGRATION_KEY?: string
  SUPABASE_URL?: string
  SUPABASE_PUBLISHABLE_KEY?: string
}

const MP_API = 'https://api.mercadopago.com'
type Json = Record<string, unknown>

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })

interface Db {
  rpc<T>(fn: string, args: Json, userToken?: string): Promise<{ ok: boolean; status: number; data: T | null }>
}

export function db(env: PaymentsEnv, fetcher: typeof fetch = fetch): Db {
  const base = (env.SUPABASE_URL || SUPABASE_PUBLIC.url).replace(/\/$/, '')
  const key = env.SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLIC.publishableKey
  return {
    async rpc<T>(fn: string, args: Json, userToken?: string) {
      try {
        const res = await fetcher(`${base}/rest/v1/rpc/${fn}`, {
          method: 'POST',
          headers: { apikey: key, Authorization: `Bearer ${userToken || key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
        })
        const data = res.ok ? ((await res.json()) as T) : null
        return { ok: res.ok, status: res.status, data }
      } catch {
        return { ok: false, status: 503, data: null }
      }
    },
  }
}

interface GatewayConfig {
  access_token: string | null
  webhook_secret: string | null
  enabled: boolean
}

async function gatewayConfig(env: PaymentsEnv, d: Db): Promise<GatewayConfig | 'sem_chave' | 'chave_invalida' | 'indisponivel'> {
  if (!env.PAYMENTS_INTEGRATION_KEY) return 'sem_chave'
  const r = await d.rpc<GatewayConfig[]>('worker_payment_config', { _key: env.PAYMENTS_INTEGRATION_KEY })
  if (r.status === 401 || r.status === 403) return 'chave_invalida'
  if (!r.ok || !r.data) return 'indisponivel'
  return r.data[0] ?? { access_token: null, webhook_secret: null, enabled: false }
}

const bearer = (req: Request) => /^Bearer\s*(\S*)$/i.exec(req.headers.get('Authorization')?.trim() ?? '')?.[1] ?? ''

/** Forma de pagamento do Mercado Pago → forma registrada na cobrança. */
export function paymentMethod(p: { payment_method_id?: string; payment_type_id?: string }): string {
  if (p.payment_method_id === 'pix') return 'pix'
  if (p.payment_type_id === 'credit_card' || p.payment_type_id === 'debit_card' || p.payment_type_id === 'prepaid_card') return 'cartao'
  if (p.payment_type_id === 'ticket') return 'boleto'
  return 'outro'
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

/** Assinatura do aviso (x-signature) conforme a documentação do Mercado Pago. */
export async function validSignature(secret: string, header: string | null, requestId: string | null, dataId: string): Promise<boolean> {
  if (!header) return false
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]))
  if (!parts.ts || !parts.v1) return false
  const manifest = `id:${dataId.toLowerCase()};${requestId ? `request-id:${requestId};` : ''}ts:${parts.ts};`
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest)))
  if (sig.length !== parts.v1.length) return false
  let diff = 0
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ parts.v1.charCodeAt(i)
  return diff === 0
}

async function checkout(req: Request, env: PaymentsEnv, siteUrl: string, d: Db, fetcher: typeof fetch): Promise<Response> {
  const token = bearer(req)
  if (!token) return json({ error: 'Entre na sua conta para pagar.' }, 401)
  const body = (await req.json().catch(() => ({}))) as { chargeId?: string }
  if (!body.chargeId || !/^[0-9a-f-]{36}$/i.test(body.chargeId)) return json({ error: 'Cobrança inválida.' }, 400)
  const ch = await d.rpc<{ id: string; business_id: string; business_name: string; description: string; amount_cents: number }[]>('payable_charge', { _charge: body.chargeId }, token)
  if (ch.status === 429) return json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, 429)
  const charge = ch.data?.[0]
  if (!ch.ok || !charge) return json({ error: 'Cobrança não encontrada, já paga ou sem permissão.' }, 404)
  const cfg = await gatewayConfig(env, d)
  if (typeof cfg === 'string' || !cfg.enabled || !cfg.access_token) return json({ error: 'Pagamento online ainda não está ativo. Fale com a Tucaí.' }, 503)
  const back = `${siteUrl}/painel/${charge.business_id}/plano`
  const res = await fetcher(`${MP_API}/checkout/preferences`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.access_token}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': `charge-${charge.id}-${Date.now()}` },
    body: JSON.stringify({
      items: [{ id: charge.id, title: `${charge.description} — ${charge.business_name}`.slice(0, 250), quantity: 1, currency_id: 'BRL', unit_price: charge.amount_cents / 100 }],
      external_reference: charge.id,
      notification_url: `${siteUrl}/api/pagamentos/webhook`,
      back_urls: { success: `${back}?pagamento=aprovado`, pending: `${back}?pagamento=pendente`, failure: `${back}?pagamento=recusado` },
      auto_return: 'approved',
      statement_descriptor: 'TUCAI',
    }),
  })
  if (!res.ok) return json({ error: 'O Mercado Pago recusou a criação do pagamento. Confira as credenciais no Painel Master.' }, 502)
  const pref = (await res.json()) as { init_point?: string }
  if (!pref.init_point) return json({ error: 'Resposta inesperada do Mercado Pago.' }, 502)
  return json({ url: pref.init_point })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Dono escolhe o plano: cria a assinatura mensal no Mercado Pago e devolve o link para autorizar o cartão. */
async function subscribe(req: Request, env: PaymentsEnv, siteUrl: string, d: Db, fetcher: typeof fetch): Promise<Response> {
  const token = bearer(req)
  if (!token) return json({ error: 'Entre na sua conta.' }, 401)
  const body = (await req.json().catch(() => ({}))) as { business?: string; plan?: string }
  if (!body.business || !UUID_RE.test(body.business) || typeof body.plan !== 'string' || !/^[a-z_]{3,40}$/.test(body.plan)) return json({ error: 'Pedido inválido.' }, 400)
  const intent = await d.rpc<{ business_id: string; business_name: string; plan_code: string; plan_name: string; price_cents: number; payer_email: string | null }>(
    'owner_start_subscription', { _business: body.business, _plan: body.plan }, token)
  if (intent.status === 429) return json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, 429)
  if (!intent.ok || !intent.data) return json({ error: 'Não foi possível iniciar a assinatura (sem permissão, plano inválido ou assinatura já ativa).' }, 409)
  const it = intent.data
  if (!it.payer_email) return json({ error: 'Sua conta precisa ter um e-mail para assinar.' }, 409)
  const cfg = await gatewayConfig(env, d)
  if (typeof cfg === 'string' || !cfg.enabled || !cfg.access_token) return json({ error: 'Pagamento online ainda não está ativo. A Tucaí vai entrar em contato para ativar o plano.' }, 503)
  const res = await fetcher(`${MP_API}/preapproval`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.access_token}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': `sub-${it.business_id}-${it.plan_code}-${Date.now()}` },
    body: JSON.stringify({
      reason: `Tucaí — Plano ${it.plan_name} (${it.business_name})`.slice(0, 250),
      external_reference: it.business_id,
      payer_email: it.payer_email,
      auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: it.price_cents / 100, currency_id: 'BRL' },
      back_url: `${siteUrl}/painel/${it.business_id}/plano?assinatura=retorno`,
      status: 'pending',
    }),
  })
  if (!res.ok) return json({ error: 'O Mercado Pago recusou a criação da assinatura. Confira as credenciais no Painel Master.' }, 502)
  const pre = (await res.json()) as { id?: string; init_point?: string }
  if (!pre.id || !pre.init_point) return json({ error: 'Resposta inesperada do Mercado Pago.' }, 502)
  // quem é o dono (para o registro): o próprio Supabase confere o token
  const saved = await d.rpc<null>('worker_save_preapproval', { _key: env.PAYMENTS_INTEGRATION_KEY, _business: it.business_id, _plan: it.plan_code, _preapproval_id: pre.id, _user: null })
  if (!saved.ok) return json({ error: 'Não foi possível registrar a assinatura. Tente de novo.' }, 503)
  return json({ url: pre.init_point })
}

/** Cancela a assinatura no Mercado Pago (dono ou Master). */
async function cancelSubscription(req: Request, env: PaymentsEnv, d: Db, fetcher: typeof fetch): Promise<Response> {
  const token = bearer(req)
  if (!token) return json({ error: 'Entre na sua conta.' }, 401)
  const body = (await req.json().catch(() => ({}))) as { business?: string }
  if (!body.business || !UUID_RE.test(body.business)) return json({ error: 'Pedido inválido.' }, 400)
  const sub = await d.rpc<{ preapproval_id: string }>('subscription_to_cancel', { _business: body.business }, token)
  if (!sub.ok || !sub.data?.preapproval_id) return json({ error: 'Não há assinatura ativa ou você não tem permissão.' }, 409)
  const cfg = await gatewayConfig(env, d)
  if (typeof cfg === 'string' || !cfg.access_token) return json({ error: 'Pagamento online indisponível agora.' }, 503)
  const res = await fetcher(`${MP_API}/preapproval/${encodeURIComponent(sub.data.preapproval_id)}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${cfg.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }),
  })
  if (!res.ok) return json({ error: 'O Mercado Pago não confirmou o cancelamento. Tente de novo.' }, 502)
  await d.rpc<string>('worker_preapproval_status', { _key: env.PAYMENTS_INTEGRATION_KEY, _preapproval_id: sub.data.preapproval_id, _status: 'cancelled' })
  return json({ ok: true })
}

/** Avisos das assinaturas: situação da assinatura e cada mensalidade cobrada (conferidas na API do Mercado Pago). */
async function subscriptionWebhook(type: string, dataId: string, env: PaymentsEnv, cfg: GatewayConfig, d: Db, fetcher: typeof fetch): Promise<Response> {
  const auth = { headers: { Authorization: `Bearer ${cfg.access_token}` } }
  if (type === 'subscription_preapproval') {
    const r = await fetcher(`${MP_API}/preapproval/${encodeURIComponent(dataId)}`, auth)
    if (r.status === 404) return json({ ok: true, ignored: 'assinatura_inexistente' })
    if (!r.ok) return json({ error: 'Mercado Pago indisponível' }, 503)
    const pre = (await r.json()) as { id?: string; status?: string }
    if (!pre.id || !pre.status) return json({ ok: true, ignored: 'sem_status' })
    const s = await d.rpc<string>('worker_preapproval_status', { _key: env.PAYMENTS_INTEGRATION_KEY, _preapproval_id: pre.id, _status: pre.status })
    return s.ok ? json({ ok: true, result: s.data }) : json({ error: 'não foi possível registrar' }, 503)
  }
  // subscription_authorized_payment: uma mensalidade
  const r = await fetcher(`${MP_API}/authorized_payments/${encodeURIComponent(dataId)}`, auth)
  if (r.status === 404) return json({ ok: true, ignored: 'cobranca_inexistente' })
  if (!r.ok) return json({ error: 'Mercado Pago indisponível' }, 503)
  const ap = (await r.json()) as { preapproval_id?: string; transaction_amount?: number; currency_id?: string; payment?: { id?: string | number; status?: string } }
  if (!ap.preapproval_id || ap.currency_id !== 'BRL' || ap.payment?.status !== 'approved' || ap.payment.id === undefined) {
    return json({ ok: true, ignored: ap.payment?.status ?? 'sem_pagamento' })
  }
  const c = await d.rpc<string>('worker_preapproval_payment', {
    _key: env.PAYMENTS_INTEGRATION_KEY, _preapproval_id: ap.preapproval_id, _payment_id: String(ap.payment.id),
    _amount_cents: Math.round((ap.transaction_amount ?? 0) * 100), _method: 'cartao',
  })
  return c.ok ? json({ ok: true, result: c.data }) : json({ error: 'não foi possível registrar' }, 503)
}

async function webhook(req: Request, env: PaymentsEnv, d: Db, fetcher: typeof fetch): Promise<Response> {
  const url = new URL(req.url)
  const body = (await req.json().catch(() => ({}))) as { type?: string; topic?: string; data?: { id?: string | number } }
  const type = body.type ?? body.topic ?? url.searchParams.get('type') ?? url.searchParams.get('topic')
  const dataId = String(body.data?.id ?? url.searchParams.get('data.id') ?? url.searchParams.get('id') ?? '')
  const isSub = type === 'subscription_preapproval' || type === 'subscription_authorized_payment'
  if (isSub ? !/^[A-Za-z0-9_-]{1,80}$/.test(dataId) : type !== 'payment' || !/^\d{1,30}$/.test(dataId)) return json({ ok: true, ignored: true })
  const cfg = await gatewayConfig(env, d)
  if (cfg === 'indisponivel') return json({ error: 'banco indisponível' }, 503) // o Mercado Pago tenta de novo
  if (typeof cfg === 'string' || !cfg.access_token) return json({ ok: true, ignored: 'nao_configurado' })
  if (cfg.webhook_secret && !(await validSignature(cfg.webhook_secret, req.headers.get('x-signature'), req.headers.get('x-request-id'), dataId))) {
    return json({ error: 'assinatura inválida' }, 401)
  }
  if (isSub) return subscriptionWebhook(type!, dataId, env, cfg, d, fetcher)
  // a fonte da verdade é a API do Mercado Pago, não o corpo do aviso
  const res = await fetcher(`${MP_API}/v1/payments/${dataId}`, { headers: { Authorization: `Bearer ${cfg.access_token}` } })
  if (res.status === 404) return json({ ok: true, ignored: 'pagamento_inexistente' })
  if (!res.ok) return json({ error: 'Mercado Pago indisponível' }, 503)
  const p = (await res.json()) as { status?: string; transaction_amount?: number; currency_id?: string; external_reference?: string; payment_method_id?: string; payment_type_id?: string }
  if (p.status !== 'approved' || p.currency_id !== 'BRL' || !p.external_reference || !/^[0-9a-f-]{36}$/i.test(p.external_reference)) {
    return json({ ok: true, ignored: p.status ?? 'sem_status' })
  }
  const r = await d.rpc<string>('worker_confirm_payment', {
    _key: env.PAYMENTS_INTEGRATION_KEY,
    _charge: p.external_reference,
    _payment_id: dataId,
    _amount_cents: Math.round((p.transaction_amount ?? 0) * 100),
    _method: paymentMethod(p),
  })
  if (!r.ok) return json({ error: 'não foi possível registrar' }, 503)
  return json({ ok: true, result: r.data })
}

async function status(req: Request, env: PaymentsEnv, d: Db, fetcher: typeof fetch): Promise<Response> {
  const token = bearer(req)
  const me = await d.rpc<unknown[]>('admin_payment_gateway_get', {}, token)
  if (!token || !me.ok) return json({ error: 'forbidden' }, 403)
  const cfg = await gatewayConfig(env, d)
  if (cfg === 'sem_chave') return json({ ok: false, reason: 'A chave de integração ainda não foi cadastrada no Cloudflare (segredo PAYMENTS_INTEGRATION_KEY).' })
  if (cfg === 'chave_invalida') return json({ ok: false, reason: 'A chave cadastrada no Cloudflare não confere com a gerada no painel. Gere outra e atualize o segredo.' })
  if (cfg === 'indisponivel') return json({ ok: false, reason: 'Banco indisponível no momento.' })
  if (!cfg.access_token) return json({ ok: false, reason: 'Access Token não cadastrado.' })
  const res = await fetcher(`${MP_API}/users/me`, { headers: { Authorization: `Bearer ${cfg.access_token}` } })
  if (!res.ok) return json({ ok: false, reason: 'O Mercado Pago recusou o Access Token. Confira se copiou o token certo.' })
  const u = (await res.json()) as { nickname?: string; email?: string; site_id?: string }
  return json({ ok: true, account: u.nickname ?? null, site: u.site_id ?? null, enabled: cfg.enabled })
}

/** Atende /api/pagamentos/*; devolve null para outras rotas. */
export async function handlePayments(req: Request, env: PaymentsEnv, siteUrl: string, fetcher: typeof fetch = fetch): Promise<Response | null> {
  const path = new URL(req.url).pathname
  if (!path.startsWith('/api/pagamentos/')) return null
  const d = db(env, fetcher)
  if (path === '/api/pagamentos/checkout' && req.method === 'POST') return checkout(req, env, siteUrl, d, fetcher)
  if (path === '/api/pagamentos/webhook' && (req.method === 'POST' || req.method === 'GET')) return webhook(req, env, d, fetcher)
  if (path === '/api/pagamentos/status' && req.method === 'GET') return status(req, env, d, fetcher)
  if (path === '/api/pagamentos/assinatura' && req.method === 'POST') return subscribe(req, env, siteUrl, d, fetcher)
  if (path === '/api/pagamentos/assinatura/cancelar' && req.method === 'POST') return cancelSubscription(req, env, d, fetcher)
  return json({ error: 'não encontrado' }, 404)
}
