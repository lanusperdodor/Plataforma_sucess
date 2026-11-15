import { z } from 'zod'
import { RepositoryError, backendUnavailable } from '../../lib/errors'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'

/** Chamadas ao servidor de pagamentos (Worker): o Access Token do Mercado Pago nunca passa pelo navegador. */

async function authHeader(): Promise<Record<string, string>> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new RepositoryError('forbidden', 'Entre na sua conta para continuar.')
  return { Authorization: `Bearer ${token}` }
}

async function call<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new RepositoryError('network', 'Sem conexão. Tente novamente.')
  }
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error || 'Não foi possível concluir agora.'
    throw new RepositoryError(res.status === 401 || res.status === 403 ? 'forbidden' : 'unknown', msg)
  }
  return schema.parse(body)
}

/** Link do Mercado Pago para pagar uma cobrança (lojista dono ou Master). */
export async function createPaymentLink(chargeId: string): Promise<string> {
  const r = await call('/api/pagamentos/checkout', { method: 'POST', headers: { ...(await authHeader()), 'Content-Type': 'application/json' }, body: JSON.stringify({ chargeId }) }, z.object({ url: z.string().url() }))
  if (!/^https:\/\/([a-z0-9-]+\.)*mercadopago\.com(\.br)?\//.test(r.url)) throw new RepositoryError('unknown', 'Link de pagamento inesperado.')
  return r.url
}

const statusSchema = z.object({ ok: z.boolean(), reason: z.string().optional(), account: z.string().nullable().optional(), site: z.string().nullable().optional(), enabled: z.boolean().optional() })
export type GatewayStatus = z.infer<typeof statusSchema>

/** Master: testa a conexão com a conta do Mercado Pago (pelo servidor). */
export async function testGateway(): Promise<GatewayStatus> {
  return call('/api/pagamentos/status', { headers: await authHeader() }, statusSchema)
}

// ---------- assinatura com débito automático (0049) ----------
/** Cria a assinatura mensal do plano no Mercado Pago e devolve o link para autorizar o cartão. */
export async function startSubscription(businessId: string, plan: 'delivery' | 'presencial_delivery'): Promise<string> {
  const r = await call('/api/pagamentos/assinatura', { method: 'POST', headers: { ...(await authHeader()), 'Content-Type': 'application/json' }, body: JSON.stringify({ business: businessId, plan }) }, z.object({ url: z.string().url() }))
  if (!/^https:\/\/([a-z0-9-]+\.)*mercadopago\.com(\.br)?\//.test(r.url)) throw new RepositoryError('unknown', 'Link de assinatura inesperado.')
  return r.url
}

/** Cancela o débito automático (dono ou Master). */
export async function cancelSubscription(businessId: string): Promise<void> {
  await call('/api/pagamentos/assinatura/cancelar', { method: 'POST', headers: { ...(await authHeader()), 'Content-Type': 'application/json' }, body: JSON.stringify({ business: businessId }) }, z.object({ ok: z.boolean() }))
}

const subSchema = z.object({ plan_code: z.string(), price_cents: z.number(), status: z.enum(['pendente', 'autorizada', 'pausada', 'cancelada']), last_payment_at: z.string().nullable() })
export type GatewaySubscription = { planCode: string; priceCents: number; status: 'pendente' | 'autorizada' | 'pausada' | 'cancelada'; lastPaymentAt: string | null }
/** Situação do débito automático da loja (null = sem assinatura ou banco sem a 0049). */
export async function getGatewaySubscription(businessId: string): Promise<GatewaySubscription | null> {
  if (!isSupabaseConfigured) return null
  const { data, error } = await supabase.from('business_gateway_subscriptions').select('plan_code,price_cents,status,last_payment_at').eq('business_id', businessId).maybeSingle()
  if (error || !data) return null
  const p = subSchema.safeParse(data)
  return p.success ? { planCode: p.data.plan_code, priceCents: p.data.price_cents, status: p.data.status, lastPaymentAt: p.data.last_payment_at } : null
}
