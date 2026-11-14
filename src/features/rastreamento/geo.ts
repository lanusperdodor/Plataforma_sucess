/** Cálculos do mapa de entrega. Tudo a partir de dados reais recebidos: nada aqui inventa posição. */
export type LngLat = [number, number]

const R = 6_371_000
const rad = (d: number) => (d * Math.PI) / 180

/** Distância em metros entre dois pontos [lng, lat]. */
export function haversine(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1])
  const dLng = rad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Projeta p no segmento a-b em coordenadas locais (metros); devolve fração t e distância até o segmento. */
function projectOnSegment(p: LngLat, a: LngLat, b: LngLat): { t: number; dist: number } {
  const k = Math.cos(rad(p[1]))
  const ax = a[0] * k, ay = a[1], bx = b[0] * k, by = b[1], px = p[0] * k, py = p[1]
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  const q: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  return { t, dist: haversine(p, q) }
}

export interface RouteProgress {
  /** metros do ponto mais próximo da rota até o fim */
  remainingM: number
  /** metros entre a posição e a rota (quanto o entregador está fora dela) */
  offRouteM: number
}

/** Onde a posição cai na rota: distância restante ao longo dela e o quanto está fora. */
export function routeProgress(position: LngLat, route: LngLat[]): RouteProgress | null {
  if (route.length < 2) return null
  let best = { i: 0, t: 0, dist: Infinity }
  for (let i = 0; i < route.length - 1; i++) {
    const s = projectOnSegment(position, route[i]!, route[i + 1]!)
    if (s.dist < best.dist) best = { i, t: s.t, dist: s.dist }
  }
  const a = route[best.i]!, b = route[best.i + 1]!
  let remaining = haversine(a, b) * (1 - best.t)
  for (let j = best.i + 1; j < route.length - 1; j++) remaining += haversine(route[j]!, route[j + 1]!)
  return { remainingM: remaining, offRouteM: best.dist }
}

/** Fora da rota acima disto, distância e previsão deixam de ser mostradas (não são confiáveis). */
export const OFF_ROUTE_M = 250

export type Freshness = 'ao_vivo' | 'atrasada' | 'desatualizada'
/** Situação da última posição: ao vivo até 60 s, atrasada até 2 min, depois desatualizada. */
export function freshness(recordedAt: string | Date, now: number = Date.now()): Freshness {
  const age = (now - new Date(recordedAt).getTime()) / 1000
  if (age <= 60) return 'ao_vivo'
  if (age <= 120) return 'atrasada'
  return 'desatualizada'
}

/** Distância e previsão só quando há rota, posição recente e o entregador está perto da rota. */
export function estimate(position: LngLat, recordedAt: string, route: { geometry: LngLat[]; distance_m: number; duration_s: number } | null, now = Date.now()):
  { remainingM: number; etaMin: number } | null {
  if (!route || freshness(recordedAt, now) === 'desatualizada' || route.distance_m <= 0) return null
  const p = routeProgress(position, route.geometry)
  if (!p || p.offRouteM > OFF_ROUTE_M) return null
  const speed = route.distance_m / Math.max(route.duration_s, 1) // m/s médios previstos pelo provedor para esta rota
  return { remainingM: p.remainingM, etaMin: Math.max(1, Math.round(p.remainingM / speed / 60)) }
}

export const formatDistance = (m: number) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`)

/** Link do Google Maps com ROTA (não busca) até o destino; a origem é a localização atual do aparelho. */
export function googleMapsRoute(dest: { lat: number; lng: number } | null, address?: string | null): string | null {
  const target = dest ? `${dest.lat},${dest.lng}` : address?.trim()
  if (!target) return null
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(target)}&travelmode=driving`
}

/** Deve enviar a posição agora? A cada ~20 s, ou antes (mín. 8 s) se andou mais de 60 m. */
export function shouldSend(last: { at: number; pos: LngLat } | null, now: number, pos: LngLat): boolean {
  if (!last) return true
  const elapsed = now - last.at
  if (elapsed >= 20_000) return true
  return elapsed >= 8_000 && haversine(last.pos, pos) > 60
}

// ---------- navegação do entregador (0046) ----------
export interface NavStep { text: string; type: string; distance_m: number; at: LngLat | null }

/**
 * Próxima instrução: cada passo começa onde terminam os anteriores (soma das distâncias). Com a distância já
 * percorrida na rota, a próxima manobra é o primeiro passo que começa à frente.
 */
export function nextStep(steps: NavStep[], routeTotalM: number, remainingM: number): { step: NavStep; inM: number } | null {
  if (steps.length === 0 || routeTotalM <= 0) return null
  const sumSteps = steps.reduce((a, s) => a + s.distance_m, 0) || routeTotalM
  // percorrido em "metros de passos" (a soma dos passos pode diferir um pouco do total da rota)
  const done = Math.max(0, Math.min(sumSteps, (1 - remainingM / routeTotalM) * sumSteps))
  let start = 0
  for (const s of steps) {
    if (start > done + 5) return { step: s, inM: start - done }
    start += s.distance_m
  }
  const last = steps[steps.length - 1]!
  return { step: last, inM: Math.max(0, sumSteps - done) }
}

/** Tempo a partir da distância e da velocidade média do veículo (usado só quando não há rota calculada). */
export const SPEED_KMH: Record<string, number> = { moto: 25, carro: 22, bicicleta: 13, a_pe: 5 }
export function roughEtaMin(distanceM: number, vehicle: string | null | undefined): number {
  const kmh = SPEED_KMH[vehicle ?? 'moto'] ?? 20
  return Math.max(1, Math.round(distanceM / 1000 / kmh * 60))
}

/** Rota no OpenStreetMap (gratuito) — alternativa quando o cálculo de rotas da Tucaí não está disponível. */
export function osmDirections(from: { lat: number; lng: number } | null, to: { lat: number; lng: number } | null): string | null {
  if (!to) return null
  const a = from ? `${from.lat.toFixed(5)},${from.lng.toFixed(5)}` : ''
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(`${a};${to.lat.toFixed(5)},${to.lng.toFixed(5)}`)}`
}
