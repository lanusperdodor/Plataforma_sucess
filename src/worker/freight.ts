/**
 * Frete por distância (0040), no servidor:
 *  POST /api/frete { business, lat, lng }  — cliente logado, com o próprio token do Supabase.
 * Fluxo: confere quem é o cliente no Supabase Auth → lê o ponto da loja (chave de integração) → rota POR RUAS no provedor
 * (chave só no Worker) → grava a cotação com a chave de integração. O pedido usa a cotação no banco: o navegador nunca
 * envia distância nem valores.
 */
import { SUPABASE_PUBLIC } from '../config/supabase-public'
import { fetchRoute, type RoutesEnv } from './routes'

export interface FreightEnv extends RoutesEnv {
  PAYMENTS_INTEGRATION_KEY?: string
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function handleFreight(req: Request, env: FreightEnv, fetcher: typeof fetch = fetch): Promise<Response | null> {
  const url = new URL(req.url)
  if (url.pathname !== '/api/frete') return null
  if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token || token.split('.').length !== 3) return json({ erro: 'Entre na sua conta.' }, 401)
  const text = await req.text()
  if (text.length > 512) return json({ erro: 'Pedido inválido.' }, 400)
  let body: { business?: unknown; lat?: unknown; lng?: unknown }
  try { body = JSON.parse(text) as typeof body } catch { return json({ erro: 'Pedido inválido.' }, 400) }
  const lat = Number(body.lat), lng = Number(body.lng)
  if (typeof body.business !== 'string' || !UUID.test(body.business) || !(lat >= -34 && lat <= 6) || !(lng >= -74 && lng <= -34)) {
    return json({ erro: 'Local de entrega inválido.' }, 400)
  }
  if (!env.PAYMENTS_INTEGRATION_KEY) return json({ erro: 'Cálculo de frete por distância ainda não configurado.' }, 503)

  const base = (env.SUPABASE_URL || SUPABASE_PUBLIC.url).replace(/\/$/, '')
  const apikey = env.SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLIC.publishableKey
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    try {
      const res = await fetcher(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey, Authorization: `Bearer ${apikey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
      return { ok: res.ok, data, message: typeof data?.message === 'string' ? data.message : null }
    } catch { return { ok: false, data: null, message: null } }
  }

  // quem é o cliente: o próprio Supabase Auth confere o token (não confiamos no navegador)
  let customer: string | null = null
  try {
    const u = await fetcher(`${base}/auth/v1/user`, { headers: { apikey, Authorization: `Bearer ${token}` } })
    if (u.ok) customer = ((await u.json()) as { id?: string }).id ?? null
  } catch { /* sem rede */ }
  if (!customer) return json({ erro: 'Entre na sua conta.' }, 401)

  const point = await rpc('worker_business_point', { _key: env.PAYMENTS_INTEGRATION_KEY, _business: body.business })
  if (!point.ok || !point.data) return json({ erro: point.message ?? 'Estabelecimento indisponível.' }, 409)
  const p = point.data as { lat: number | null; lng: number | null; delivery_offer: string }
  if (p.delivery_offer !== 'partner') return json({ erro: 'Esta loja não usa entregador parceiro.' }, 409)
  if (p.lat === null || p.lng === null) return json({ erro: 'A loja ainda não marcou o endereço no mapa. O frete padrão será usado.' }, 409)

  const route = await fetchRoute(env, [Number(p.lng), Number(p.lat)], [lng, lat], fetcher)
  if (route === 'sem_chave') return json({ erro: 'Cálculo de rotas ainda não configurado. O frete padrão será usado.' }, 503)
  if (!route) return json({ erro: 'O serviço de rotas não respondeu. Tente de novo em instantes.' }, 502)

  const saved = await rpc('worker_store_delivery_quote', {
    _key: env.PAYMENTS_INTEGRATION_KEY, _customer: customer, _business: body.business, _lat: lat, _lng: lng,
    _distance_m: route.distanceM, _duration_s: route.durationS, _provider: route.provider,
  })
  if (!saved.ok || !saved.data) return json({ erro: saved.message ?? 'Não foi possível calcular o frete.' }, 409)
  return json(saved.data)
}
