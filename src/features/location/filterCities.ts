import { foldText } from '../../lib/geo'
import type { City } from '../catalog/schemas'

export interface CityFilters {
  /** Nome da cidade (sem acento/caixa) ou código IBGE. */
  query?: string
  /** UF; vazio = todas. */
  state?: string
  /** Filtro regional: distância máxima até a sede da plataforma (km). */
  maxDistanceKm?: number | null
}

/** Faixas do filtro regional (km até a sede). A área de atendimento é de 100 km. */
export const DISTANCE_BANDS = [25, 50, 100] as const

export function filterCities(cities: readonly City[], f: CityFilters): City[] {
  const q = foldText(f.query ?? '')
  const uf = (f.state ?? '').trim().toUpperCase()
  return cities.filter((c) => {
    if (uf && c.state !== uf) return false
    if (f.maxDistanceKm != null && (c.distanceFromHqKm == null || c.distanceFromHqKm > f.maxDistanceKm)) return false
    if (!q) return true
    return foldText(c.name).includes(q) || (c.ibgeCode != null && String(c.ibgeCode) === q)
  })
}

/** UFs presentes na lista, em ordem alfabética (para os filtros). */
export function statesOf(cities: readonly City[]): string[] {
  return [...new Set(cities.map((c) => c.state))].sort()
}
