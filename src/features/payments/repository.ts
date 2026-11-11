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
