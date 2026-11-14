/**
 * Instruções de conversão (navegação) normalizadas, em português, a partir do openrouteservice ou do OSRM.
 * Formato único: { text, type, distance_m, at:[lng,lat] }. O texto é limpo (sem < >) e limitado.
 */
type LngLat = [number, number]
export interface RouteStep { text: string; type: string; distance_m: number; at: LngLat | null }

const clean = (s: unknown, max = 160) => (typeof s === 'string' ? s.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '')
const r5 = (p: unknown): LngLat | null =>
  Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [Math.round(Number(p[0]) * 1e5) / 1e5, Math.round(Number(p[1]) * 1e5) / 1e5] : null

// openrouteservice: códigos de manobra → tipo
const ORS_TYPE: Record<number, string> = {
  0: 'turn-left', 1: 'turn-right', 2: 'sharp-left', 3: 'sharp-right', 4: 'slight-left', 5: 'slight-right', 6: 'straight',
  7: 'roundabout', 8: 'roundabout-exit', 9: 'uturn', 10: 'arrive', 11: 'depart', 12: 'keep-left', 13: 'keep-right',
}

/** Passos do openrouteservice (pedidos com instructions=true e language=pt). `coords` = geometria completa, antes de simplificar. */
export function orsSteps(segments: unknown, coords: LngLat[]): RouteStep[] {
  const out: RouteStep[] = []
  if (!Array.isArray(segments)) return out
  for (const seg of segments as { steps?: unknown[] }[]) {
    for (const st of (seg?.steps ?? []) as { instruction?: unknown; type?: unknown; distance?: unknown; way_points?: unknown }[]) {
      const wp = Array.isArray(st.way_points) ? Number(st.way_points[0]) : NaN
      out.push({
        text: clean(st.instruction) || 'Siga em frente',
        type: ORS_TYPE[Number(st.type)] ?? 'straight',
        distance_m: Math.max(0, Math.round(Number(st.distance) || 0)),
        at: Number.isInteger(wp) ? r5(coords[wp]) : null,
      })
      if (out.length >= 120) return out
    }
  }
  return out
}

const MOD: Record<string, string> = {
  left: 'à esquerda', right: 'à direita', 'sharp left': 'acentuadamente à esquerda', 'sharp right': 'acentuadamente à direita',
  'slight left': 'levemente à esquerda', 'slight right': 'levemente à direita', straight: 'em frente', uturn: 'retorne',
}
const MOD_TYPE: Record<string, string> = {
  left: 'turn-left', right: 'turn-right', 'sharp left': 'sharp-left', 'sharp right': 'sharp-right',
  'slight left': 'slight-left', 'slight right': 'slight-right', straight: 'straight', uturn: 'uturn',
}

/** Texto em português para uma manobra do OSRM (o OSRM não traz o texto pronto). */
export function osrmText(type: string, modifier: string | undefined, name: string, exit?: number): string {
  const on = name ? ` na ${name}` : ''
  const dir = modifier ? MOD[modifier] ?? '' : ''
  switch (type) {
    case 'depart': return `Siga${name ? ` pela ${name}` : ''}`
    case 'arrive': return 'Você chegou ao destino'
    case 'roundabout': case 'rotary': return `Na rotatória, pegue a ${exit ?? 1}ª saída${on}`
    case 'exit roundabout': case 'exit rotary': return `Saia da rotatória${on}`
    case 'fork': return `Na bifurcação, mantenha-se ${dir || 'em frente'}${on}`
    case 'merge': return `Entre${on}`
    case 'on ramp': return `Pegue a entrada${on}`
    case 'off ramp': return `Pegue a saída${on}`
    case 'end of road': return `No fim da rua, vire ${dir}${on}`.replace('vire  ', 'vire ')
    case 'continue': case 'new name': return modifier && modifier !== 'straight' ? `Continue ${dir}${on}` : `Continue em frente${on}`
    default:
      if (modifier === 'uturn') return `Faça o retorno${on}`
      if (modifier === 'straight' || !modifier) return `Siga em frente${on}`
      return `Vire ${dir}${on}`
  }
}

/** Passos do OSRM (pedidos com steps=true). */
export function osrmSteps(legs: unknown): RouteStep[] {
  const out: RouteStep[] = []
  if (!Array.isArray(legs)) return out
  for (const leg of legs as { steps?: unknown[] }[]) {
    for (const st of (leg?.steps ?? []) as { name?: unknown; distance?: unknown; maneuver?: { type?: string; modifier?: string; location?: unknown; exit?: number } }[]) {
      const m = st.maneuver ?? {}
      const type = String(m.type ?? 'continue')
      out.push({
        text: clean(osrmText(type, m.modifier, clean(st.name, 80), m.exit)),
        type: type === 'arrive' ? 'arrive' : type === 'depart' ? 'depart' : type.includes('roundabout') || type === 'rotary' ? 'roundabout' : MOD_TYPE[m.modifier ?? ''] ?? 'straight',
        distance_m: Math.max(0, Math.round(Number(st.distance) || 0)),
        at: r5(m.location),
      })
      if (out.length >= 120) return out
    }
  }
  return out
}
