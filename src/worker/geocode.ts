/**
 * Endereço → coordenadas (para o ponto de entrega quando o cliente não marcou no mapa):
 *  POST /api/geocode { address, near?: { lat, lng } }  — pessoa logada, com o próprio token do Supabase.
 * Usa a busca de endereços do openrouteservice (gratuita, mesma chave das rotas, só no Worker). Só aceita resultado
 * com precisão de endereço/rua/local (nunca o centro da cidade) e dentro do Brasil. Não grava nada: quem grava é o
 * banco, pela função do cliente ou do entregador, que conferem a permissão.
 */
import { SUPABASE_PUBLIC } from '../config/supabase-public'

export interface GeocodeEnv { ORS_API_KEY?: string; SUPABASE_URL?: string; SUPABASE_PUBLISHABLE_KEY?: string }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })

const PRECISE = new Set(['address', 'venue', 'street'])

export async function handleGeocode(req: Request, env: GeocodeEnv, fetcher: typeof fetch = fetch): Promise<Response | null> {
  if (new URL(req.url).pathname !== '/api/geocode') return null
  if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token || token.split('.').length !== 3) return json({ erro: 'Entre na sua conta.' }, 401)
  const text = await req.text()
  if (text.length > 800) return json({ erro: 'Pedido inválido.' }, 400)
  let body: { address?: unknown; near?: { lat?: unknown; lng?: unknown } }
  try { body = JSON.parse(text) as typeof body } catch { return json({ erro: 'Pedido inválido.' }, 400) }
  const address = typeof body.address === 'string' ? body.address.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim() : ''
  if (address.length < 8 || address.length > 300) return json({ erro: 'Endereço inválido.' }, 400)
  if (!env.ORS_API_KEY) return json({ erro: 'Busca de endereços ainda não configurada.' }, 503)

  const base = (env.SUPABASE_URL || SUPABASE_PUBLIC.url).replace(/\/$/, '')
  const apikey = env.SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLIC.publishableKey
  try {
    const u = await fetcher(`${base}/auth/v1/user`, { headers: { apikey, Authorization: `Bearer ${token}` } })
    if (!u.ok) return json({ erro: 'Entre na sua conta.' }, 401)
  } catch { return json({ erro: 'Sem conexão com o servidor.' }, 503) }

  const qs = new URLSearchParams({ text: address, 'boundary.country': 'BR', size: '1', layers: 'address,venue,street' })
  const lat = Number(body.near?.lat), lng = Number(body.near?.lng)
  if (lat >= -34 && lat <= 6 && lng >= -74 && lng <= -34) { qs.set('focus.point.lat', String(lat)); qs.set('focus.point.lon', String(lng)) }
  type GeoBody = { features?: { geometry?: { coordinates?: [number, number] }; properties?: { layer?: string; confidence?: number; label?: string } }[] }
  let data: GeoBody
  try {
    const r = await fetcher(`https://api.openrouteservice.org/geocode/search?${qs.toString()}`, { headers: { Authorization: env.ORS_API_KEY.trim(), Accept: 'application/json' } })
    if (r.status === 429) return json({ erro: 'Limite diário da busca de endereços atingido.' }, 503)
    if (!r.ok) return json({ erro: 'A busca de endereços não respondeu.' }, 502)
    data = (await r.json()) as GeoBody
  } catch { return json({ erro: 'A busca de endereços não respondeu.' }, 502) }
  const f = data.features?.[0]
  const c = f?.geometry?.coordinates
  const layer = f?.properties?.layer ?? ''
  if (!c || !PRECISE.has(layer) || !(c[1] >= -34 && c[1] <= 6 && c[0] >= -74 && c[0] <= -34)) return json({ erro: 'Endereço não encontrado com precisão.' }, 404)
  return json({ lat: Math.round(c[1] * 1e5) / 1e5, lng: Math.round(c[0] * 1e5) / 1e5, precisao: layer, confianca: f?.properties?.confidence ?? null, rotulo: (f?.properties?.label ?? '').slice(0, 160) })
}
