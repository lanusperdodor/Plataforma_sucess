/**
 * Pagamentos com Mercado Pago (Checkout Pro), no servidor:
 *  POST /api/pagamentos/checkout  → cria o link de pagamento de uma cobrança (lojista dono ou Master)
 *  POST /api/pagamentos/webhook   → aviso do Mercado Pago; confere o pagamento na API e dá baixa
 *  GET  /api/pagamentos/status    → Master testa a conexão com a conta do Mercado Pago
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

const bearer = (req: Request) => req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || ''

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

async function webhook(req: Request, env: PaymentsEnv, d: Db, fetcher: typeof fetch): Promise<Response> {
  const url = new URL(req.url)
  const body = (await req.json().catch(() => ({}))) as { type?: string; topic?: string; data?: { id?: string | number } }
  const type = body.type ?? body.topic ?? url.searchParams.get('type') ?? url.searchParams.get('topic')
  const dataId = String(body.data?.id ?? url.searchParams.get('data.id') ?? url.searchParams.get('id') ?? '')
  if (type !== 'payment' || !/^\d{1,30}$/.test(dataId)) return json({ ok: true, ignored: true })
  const cfg = await gatewayConfig(env, d)
  if (cfg === 'indisponivel') return json({ error: 'banco indisponível' }, 503) // o Mercado Pago tenta de novo
  if (typeof cfg === 'string' || !cfg.access_token) return json({ ok: true, ignored: 'nao_configurado' })
  if (cfg.webhook_secret && !(await validSignature(cfg.webhook_secret, req.headers.get('x-signature'), req.headers.get('x-request-id'), dataId))) {
    return json({ error: 'assinatura inválida' }, 401)
  }
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
  return json({ error: 'não encontrado' }, 404)
}
