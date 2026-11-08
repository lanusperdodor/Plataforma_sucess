import type { QuerySpec } from '../features/catalog/filters'
import type { BusinessSummary } from '../features/catalog/schemas'

/** Coluna da visão `public_businesses` (snake_case) -> campo de `BusinessSummary`. */
const COLUMN_TO_FIELD: Record<string, keyof BusinessSummary> = {
  id: 'id',
  city_id: 'cityId',
  business_type: 'businessType',
  category_id: 'categoryId',
  delivery_offer: 'deliveryOffer',
  accepts_pickup: 'acceptsPickup',
  rating_avg: 'ratingAvg',
  price_tier: 'priceTier',
  distance_estimate_km: 'distanceEstimateKm',
  estimated_min_minutes: 'estimatedMinMinutes',
  popularity_score: 'popularityScore',
  is_featured: 'isFeatured',
}

function value(row: BusinessSummary, column: string): unknown {
  const field = COLUMN_TO_FIELD[column]
  if (!field) throw new Error(`Coluna desconhecida no applySpec: ${column}`)
  return row[field]
}

function compareValues(a: unknown, b: unknown): number {
  return a === b ? 0 : (a as number | string) < (b as number | string) ? -1 : 1
}

/**
 * Interpreta um `QuerySpec` sobre uma lista em memória (apenas testes), com a semântica do
 * Postgres: `asc` põe nulos por último, `desc` põe nulos primeiro; comparações com null não casam.
 */
export function applySpec(rows: readonly BusinessSummary[], spec: QuerySpec): BusinessSummary[] {
  const kept = rows.filter(
    (r) =>
      spec.eq.every(([c, v]) => value(r, c) === v) &&
      spec.gte.every(([c, v]) => {
        const x = value(r, c)
        return typeof x === 'number' && x >= v
      }) &&
      spec.in.every(([c, vs]) => vs.includes(value(r, c))) &&
      spec.notNull.every((c) => value(r, c) !== null),
  )
  return kept.sort((a, b) => {
    for (const [column, dir] of spec.order) {
      const x = value(a, column)
      const y = value(b, column)
      if (x === y) continue
      let cmp: number
      if (x === null) cmp = dir === 'asc' ? 1 : -1
      else if (y === null) cmp = dir === 'asc' ? -1 : 1
      else cmp = dir === 'asc' ? compareValues(x, y) : compareValues(y, x)
      if (cmp !== 0) return cmp
    }
    return 0
  })
}
