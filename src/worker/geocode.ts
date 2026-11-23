/**
 * Endereço → coordenadas (para o ponto de entrega quando o cliente não marcou no mapa):
 *  POST /api/geocode { address, near?: { lat, lng } }  — pessoa logada, com o próprio token do Supabase.
 * Usa a busca de endereços do openrouteservice (gratuita, mesma chave das rotas, só no Worker). Tenta, em ordem: busca
 * estruturada (rua, número, bairro, cidade, UF, CEP), texto completo e rua + bairro + cidade. Só aceita resultado com
 * precisão de endereço/rua/local, na UF e cidade informadas e dentro do Brasil. Com `aproximado: true`, aceita por último
 * o bairro/cidade, marcado como aproximado (a tela pede para conferir no mapa). Não grava nada: quem grava é o
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
  if (text.length > 1500) return json({ erro: 'Pedido inválido.' }, 400)
  let body: { address?: unknown; near?: { lat?: unknown; lng?: unknown }; parts?: unknown; aproximado?: unknown }
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
  // cota (0058): 30 buscas/hora por pessoa e teto diário geral, para ninguém esgotar o serviço gratuito de todos
  try {
    const q = await fetcher(`${base}/rest/v1/rpc/geocode_allow`, { method: 'POST', headers: { apikey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' })
    if (!q.ok && q.status !== 404) {
      const e = (await q.json().catch(() => ({}))) as { code?: string; message?: string }
      if (e.code === 'PT429') return json({ erro: e.message || 'Muitas buscas em pouco tempo. Aguarde e tente de novo, ou marque no mapa.' }, 429)
      return json({ erro: 'Sem conexão com o servidor.' }, 503)
    }
  } catch { return json({ erro: 'Sem conexão com o servidor.' }, 503) }

  const parts = cleanParts(body.parts)
  const allowApprox = body.aproximado === true
  const lat = Number(body.near?.lat), lng = Number(body.near?.lng)
  const focus = lat >= -34 && lat <= 6 && lng >= -74 && lng <= -34 ? { lat, lng } : null
  const auth = { headers: { Authorization: env.ORS_API_KEY.trim(), Accept: 'application/json' } }

  // várias tentativas, da mais precisa para a mais ampla (endereços de cidade pequena nem sempre têm número no mapa)
  const attempts: { path: string; qs: URLSearchParams; approx: boolean }[] = []
  const common = (q: URLSearchParams) => { q.set('boundary.country', 'BR'); q.set('size', '5'); if (focus) { q.set('focus.point.lat', String(focus.lat)); q.set('focus.point.lon', String(focus.lng)) }; return q }
  if (parts && parts.street && parts.city) {
    const st = new URLSearchParams({ address: [parts.street, parts.number].filter(Boolean).join(' '), locality: parts.city, layers: 'address,venue,street' })
    if (parts.district) st.set('neighbourhood', parts.district)
    if (parts.uf) st.set('region', parts.uf)
    if (parts.cep) st.set('postalcode', parts.cep)
    attempts.push({ path: 'search/structured', qs: common(st), approx: false })
  }
  attempts.push({ path: 'search', qs: common(new URLSearchParams({ text: address, layers: 'address,venue,street' })), approx: false })
  if (parts && parts.street && parts.city) {
    attempts.push({ path: 'search', qs: common(new URLSearchParams({ text: [parts.street, parts.district, parts.city, parts.uf].filter(Boolean).join(', '), layers: 'street,address' })), approx: false })
    if (allowApprox) attempts.push({ path: 'search', qs: common(new URLSearchParams({ text: [parts.district, parts.city, parts.uf].filter(Boolean).join(', '), layers: 'neighbourhood,locality' })), approx: true })
  }

  let lastStatus = 404
  for (const t of attempts) {
    let data: GeoBody
    try {
      const r = await fetcher(`https://api.openrouteservice.org/geocode/${t.path}?${t.qs.toString()}`, auth)
      if (r.status === 429) return json({ erro: 'Limite diário da busca de endereços atingido. Marque no mapa ou cole a coordenada.' }, 503)
      if (!r.ok) { lastStatus = 502; continue }
      data = (await r.json()) as GeoBody
    } catch { lastStatus = 502; continue }
    const hit = pick(data, parts, t.approx)
    if (hit) return json(hit)
  }
  return lastStatus === 502 && attempts.length === 1
    ? json({ erro: 'A busca de endereços não respondeu.' }, 502)
    : json({ erro: 'Endereço não encontrado com precisão.' }, 404)
}

type GeoFeature = { geometry?: { coordinates?: [number, number] }; properties?: { layer?: string; confidence?: number; label?: string; region_a?: string; region?: string; locality?: string; county?: string } }
type GeoBody = { features?: GeoFeature[] }
interface Parts { street: string; number: string; district: string; city: string; uf: string; cep: string }

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const UF_NAME: Record<string, string> = { AC: 'acre', AL: 'alagoas', AP: 'amapa', AM: 'amazonas', BA: 'bahia', CE: 'ceara', DF: 'distrito federal', ES: 'espirito santo', GO: 'goias', MA: 'maranhao', MT: 'mato grosso', MS: 'mato grosso do sul', MG: 'minas gerais', PA: 'para', PB: 'paraiba', PR: 'parana', PE: 'pernambuco', PI: 'piaui', RJ: 'rio de janeiro', RN: 'rio grande do norte', RS: 'rio grande do sul', RO: 'rondonia', RR: 'roraima', SC: 'santa catarina', SP: 'sao paulo', SE: 'sergipe', TO: 'tocantins' }

function cleanParts(v: unknown): Parts | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const g = (k: string, max: number) => (typeof o[k] === 'string' ? (o[k] as string).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '')
  const p = { street: g('street', 120), number: g('number', 20).replace(/^s\/?n$/i, ''), district: g('district', 80), city: g('city', 80), uf: g('uf', 2).toUpperCase(), cep: g('cep', 9).replace(/\D/g, '') }
  return p.city ? p : null
}

/** Escolhe o primeiro resultado no Brasil, na UF/cidade informadas e com a precisão pedida. */
function pick(data: GeoBody, parts: Parts | null, approx: boolean) {
  for (const f of data.features ?? []) {
    const c = f.geometry?.coordinates
    const pr = f.properties ?? {}
    const layer = pr.layer ?? ''
    if (!c || !(c[1] >= -34 && c[1] <= 6 && c[0] >= -74 && c[0] <= -34)) continue
    if (approx ? !['neighbourhood', 'locality', ...PRECISE].includes(layer) : !PRECISE.has(layer)) continue
    if (parts?.uf) {
      const ra = (pr.region_a ?? '').toUpperCase(), rn = norm(pr.region ?? '')
      if ((ra || rn) && ra !== parts.uf && rn !== UF_NAME[parts.uf]) continue
    }
    if (parts?.city && pr.locality && norm(pr.locality) !== norm(parts.city) && pr.county && norm(pr.county) !== norm(parts.city)) continue
    return {
      lat: Math.round(c[1] * 1e5) / 1e5, lng: Math.round(c[0] * 1e5) / 1e5, precisao: layer,
      aproximado: approx && !PRECISE.has(layer), confianca: pr.confidence ?? null, rotulo: (pr.label ?? '').slice(0, 160),
    }
  }
  return null
}
