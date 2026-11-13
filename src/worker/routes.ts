/**
 * Rotas de entrega (0037), no servidor:
 *  POST /api/rota  { order, leg: 'coleta' | 'entrega' }  — só o entregador da entrega, com o próprio token do Supabase.
 * Fluxo: route_request (autoriza, limita e devolve origem/destino + bilhete) → provedor de rotas → route_store (grava).
 * A chave do provedor fica só no Worker (segredo ORS_API_KEY ou MAPBOX_TOKEN); o navegador nunca a vê.
 * Limites: 6 rotas por entrega e teto diário da plataforma, conferidos no banco; aqui só o tamanho da resposta.
 */
import { SUPABASE_PUBLIC } from '../config/supabase-public'

export interface RoutesEnv {
  /** 'ors' (openrouteservice, padrão), 'osrm' (servidor OSRM próprio da Tucaí) ou 'mapbox'. */
  ROUTING_PROVIDER?: string
  /** URL do OSRM próprio (ex.: https://rotas.tucai.com.br). Nunca o servidor público de demonstração. */
  OSRM_URL?: string
  ORS_API_KEY?: string
  MAPBOX_TOKEN?: string
  SUPABASE_URL?: string
  SUPABASE_PUBLISHABLE_KEY?: string
}

type LngLat = [number, number]
export interface ProviderRoute { geometry: LngLat[]; distanceM: number; durationS: number; provider: string }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })

/** Reduz a geometria (menos dados para gravar e para o celular desenhar) mantendo início e fim. */
export function simplify(points: LngLat[], max = 400): LngLat[] {
  const clean = points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5] as LngLat)
  if (clean.length <= max) return clean
  const step = (clean.length - 1) / (max - 1)
  const out: LngLat[] = []
  for (let i = 0; i < max; i++) out.push(clean[Math.round(i * step)]!)
  return out
}

/** Consulta o provedor configurado. Devolve null quando não há chave ou o provedor falhou. */
export interface RouteFailure { status: number; code?: string | number; message?: string }

/** Motivo da recusa do provedor, sem nada que possa conter a chave (só código e mensagem curta). */
async function failure(res: Response): Promise<RouteFailure> {
  const text = await res.text().catch(() => '')
  const body = ((): { error?: unknown; message?: unknown } | null => { try { return JSON.parse(text) as { error?: unknown; message?: unknown } } catch { return null } })()
  const e = body?.error
  const code = e && typeof e === 'object' ? (e as { code?: string | number }).code : undefined
  const raw = e && typeof e === 'object' ? (e as { message?: unknown }).message : typeof e === 'string' ? e : typeof body?.message === 'string' ? body.message : text.replace(/<[^>]*>/g, ' ')
  const message = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').replace(/[A-Za-z0-9_=-]{24,}/g, '…').trim().slice(0, 160) || undefined : undefined
  return { status: res.status, code, message }
}

export async function fetchRoute(env: RoutesEnv, from: LngLat, to: LngLat, fetcher: typeof fetch = fetch, onFail?: (f: RouteFailure) => void): Promise<ProviderRoute | 'sem_chave' | null> {
  const provider = (env.ROUTING_PROVIDER || 'ors').toLowerCase()
  try {
    if (provider === 'osrm') {
      // OSRM próprio: o servidor de demonstração do projeto não pode ser usado em produção (política de uso)
      if (!env.OSRM_URL || /router\.project-osrm\.org/i.test(env.OSRM_URL) || !/^https:\/\//i.test(env.OSRM_URL)) return 'sem_chave'
      const base = env.OSRM_URL.replace(/\/$/, '')
      const res = await fetcher(`${base}/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?overview=simplified&geometries=geojson`)
      if (!res.ok) return null
      const body = (await res.json()) as { code?: string; routes?: { geometry?: { coordinates?: LngLat[] }; distance?: number; duration?: number }[] }
      const r = body.routes?.[0]
      if (body.code !== 'Ok' || !r?.geometry?.coordinates || r.geometry.coordinates.length < 2) return null
      return { geometry: simplify(r.geometry.coordinates), distanceM: Math.round(r.distance ?? 0), durationS: Math.round(r.duration ?? 0), provider: 'osrm' }
    }
    if (provider === 'mapbox') {
      if (!env.MAPBOX_TOKEN) return 'sem_chave'
      const coords = `${from[0]},${from[1]};${to[0]},${to[1]}`
      const res = await fetcher(`https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=simplified&access_token=${encodeURIComponent(env.MAPBOX_TOKEN)}`)
      if (!res.ok) return null
      const body = (await res.json()) as { routes?: { geometry?: { coordinates?: LngLat[] }; distance?: number; duration?: number }[] }
      const r = body.routes?.[0]
      if (!r?.geometry?.coordinates || r.geometry.coordinates.length < 2) return null
      return { geometry: simplify(r.geometry.coordinates), distanceM: Math.round(r.distance ?? 0), durationS: Math.round(r.duration ?? 0), provider: 'mapbox' }
    }
    if (!env.ORS_API_KEY) return 'sem_chave'
    const key = env.ORS_API_KEY.trim()
    const res = await fetcher('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
      method: 'POST',
      headers: { Authorization: key, 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json, application/geo+json; charset=utf-8' },
      body: JSON.stringify({ coordinates: [from, to], instructions: false }),
    })
    type OrsBody = { features?: { geometry?: { coordinates?: LngLat[] }; properties?: { summary?: { distance?: number; duration?: number } } }[] }
    let body: OrsBody
    if (res.ok) body = (await res.json()) as OrsBody
    else {
      onFail?.(await failure(res))
      // reserva: a mesma rota pelo GET (aceito pelo openrouteservice com a chave no cabeçalho)
      const alt = await fetcher(`https://api.openrouteservice.org/v2/directions/driving-car?start=${from[0]},${from[1]}&end=${to[0]},${to[1]}`, {
        headers: { Authorization: key, Accept: 'application/json, application/geo+json; charset=utf-8' },
      })
      if (!alt.ok) { onFail?.(await failure(alt)); return null }
      body = (await alt.json()) as OrsBody
    }
    const f = body.features?.[0]
    if (!f?.geometry?.coordinates || f.geometry.coordinates.length < 2) return null
    return { geometry: simplify(f.geometry.coordinates), distanceM: Math.round(f.properties?.summary?.distance ?? 0), durationS: Math.round(f.properties?.summary?.duration ?? 0), provider: 'openrouteservice' }
  } catch (e) {
    onFail?.({ status: 0, message: e instanceof Error ? e.message.slice(0, 160) : 'sem rede' })
    return null
  }
}

async function rpc(env: RoutesEnv, fn: string, args: Record<string, unknown>, token: string, fetcher: typeof fetch) {
  const base = (env.SUPABASE_URL || SUPABASE_PUBLIC.url).replace(/\/$/, '')
  const key = env.SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLIC.publishableKey
  try {
    const res = await fetcher(`${base}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    return { ok: res.ok, status: res.status, data: body, message: typeof body?.message === 'string' ? body.message : null }
  } catch {
    return { ok: false, status: 503, data: null, message: null }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function handleRoutes(req: Request, env: RoutesEnv, fetcher: typeof fetch = fetch): Promise<Response | null> {
  const url = new URL(req.url)
  if (url.pathname !== '/api/rota') return null
  if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token || token.split('.').length !== 3) return json({ erro: 'Entre na sua conta.' }, 401)
  const text = await req.text()
  if (text.length > 512) return json({ erro: 'Pedido inválido.' }, 400)
  let body: { order?: unknown; leg?: unknown }
  try { body = JSON.parse(text) as typeof body } catch { return json({ erro: 'Pedido inválido.' }, 400) }
  if (typeof body.order !== 'string' || !UUID.test(body.order) || (body.leg !== 'coleta' && body.leg !== 'entrega')) return json({ erro: 'Pedido inválido.' }, 400)

  const auth = await rpc(env, 'route_request', { _order: body.order, _leg: body.leg }, token, fetcher)
  if (!auth.ok || !auth.data) {
    const status = auth.status === 401 || auth.status === 403 ? 403 : auth.status >= 500 ? 503 : 409
    return json({ erro: auth.message ?? 'Não foi possível calcular a rota agora.' }, status)
  }
  const a = auth.data as { ticket: string; origin: { lat: number; lng: number }; destination: { lat: number; lng: number } }
  const route = await fetchRoute(env, [Number(a.origin.lng), Number(a.origin.lat)], [Number(a.destination.lng), Number(a.destination.lat)], fetcher)
  if (route === 'sem_chave') return json({ erro: 'Cálculo de rotas ainda não configurado. Use o Google Maps.' }, 503)
  if (!route) return json({ erro: 'O serviço de rotas não respondeu. Use o Google Maps.' }, 502)
  const saved = await rpc(env, 'route_store', { _ticket: a.ticket, _geometry: route.geometry, _distance_m: route.distanceM, _duration_s: route.durationS, _provider: route.provider }, token, fetcher)
  if (!saved.ok) return json({ erro: saved.message ?? 'Não foi possível salvar a rota.' }, 409)
  return json({ distance_m: route.distanceM, duration_s: route.durationS, provider: route.provider, points: route.geometry.length })
}
