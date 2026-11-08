import type { CategoryKind } from './schemas'

type Plain = string | number | boolean | null | undefined | readonly (string | number | boolean)[]

/**
 * Normaliza filtros para chaves de cache estáveis: remove vazios e valores padrão,
 * ordena as chaves e ordena/deduplica listas.
 */
export function normalize(
  filters: Record<string, Plain> | undefined,
  defaults: Record<string, Plain> = {},
): Record<string, string | number | boolean | (string | number | boolean)[]> {
  const out: Record<string, string | number | boolean | (string | number | boolean)[]> = {}
  if (!filters) return out
  for (const key of Object.keys(filters).sort()) {
    const raw = filters[key]
    if (raw === undefined || raw === null || raw === '' || raw === false) continue
    let value: string | number | boolean | (string | number | boolean)[]
    if (Array.isArray(raw)) {
      const list = [...new Set(raw as (string | number | boolean)[])].sort((a, b) =>
        String(a).localeCompare(String(b)),
      )
      if (list.length === 0) continue
      value = list
    } else {
      value = raw as string | number | boolean
    }
    const def = defaults[key]
    if (def !== undefined && JSON.stringify(def) === JSON.stringify(value)) continue
    out[key] = value
  }
  return out
}

export const qk = {
  cities: () => ['catalog', 'cities'] as const,
  categories: (kind?: CategoryKind) => ['catalog', 'categories', kind ?? 'all'] as const,
  restaurants: (cityId: string, filters?: Record<string, Plain>, defaults?: Record<string, Plain>) =>
    ['catalog', 'restaurants', cityId, normalize(filters, defaults)] as const,
  featured: (cityId: string) => ['catalog', 'featured', cityId] as const,
  businessHours: (businessId: string) => ['catalog', 'hours', businessId] as const,
}
