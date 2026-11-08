import { getEnum, getList, getString, setParams } from '../../lib/url-state'
import type { RestaurantQueryFilters, RestaurantSort } from './repository'
import type { BusinessSummary } from './schemas'

/**
 * Filtros de restaurantes: leitura/escrita na URL, definição semântica (em memória)
 * e especificação de consulta (`QuerySpec`) usada pelo repositório.
 *
 * Nota: o filtro "somente promoções" (`onlyPromo`) NÃO existe ainda. As promoções virão de
 * campanhas reais (migração 0004); até lá não há dado para filtrar.
 */

export const SORTS = ['proximity', 'popularity', 'delivery_time'] as const satisfies readonly RestaurantSort[]
export const DEFAULT_SORT: RestaurantSort = 'popularity'
export const FULFILLMENTS = ['delivery', 'pickup'] as const
export const MIN_RATINGS = [3, 3.5, 4, 4.5] as const
export const PRICE_TIERS = [1, 2, 3, 4] as const

export type MinRating = (typeof MIN_RATINGS)[number]
export type PriceTier = (typeof PRICE_TIERS)[number]

export interface RestaurantFilters {
  categorySlug?: string
  fulfillment?: 'delivery' | 'pickup'
  minRating?: MinRating
  priceTiers?: PriceTier[]
  sort: RestaurantSort
}

// ---------- URL ----------

/** Entrada inválida vira o padrão (campo ausente / ordenação padrão). */
export function parseRestaurantFilters(params: URLSearchParams): RestaurantFilters {
  const filters: RestaurantFilters = {
    sort: getEnum(params, 'sort', SORTS) ?? DEFAULT_SORT,
  }
  const categorySlug = getString(params, 'categoria')?.trim()
  if (categorySlug) filters.categorySlug = categorySlug
  const fulfillment = getEnum(params, 'modo', FULFILLMENTS)
  if (fulfillment) filters.fulfillment = fulfillment
  const rating = getString(params, 'nota')
  const minRating = MIN_RATINGS.find((r) => String(r) === rating)
  if (minRating !== undefined) filters.minRating = minRating
  const tiers = PRICE_TIERS.filter((t) => getList(params, 'preco').includes(String(t)))
  if (tiers.length > 0) filters.priceTiers = [...tiers]
  return filters
}

/** Omite valores padrão para manter a URL curta e canônica. */
export function serializeRestaurantFilters(f: RestaurantFilters): URLSearchParams {
  const tiers = f.priceTiers ? PRICE_TIERS.filter((t) => f.priceTiers?.includes(t)) : []
  return setParams(new URLSearchParams(), {
    categoria: f.categorySlug,
    modo: f.fulfillment,
    nota: f.minRating,
    preco: tiers.length > 0 ? [tiers.join(',')] : undefined,
    sort: f.sort === DEFAULT_SORT ? undefined : f.sort,
  })
}

/** Adapta para o formato aceito pelo repositório. */
export function toQueryFilters(f: RestaurantFilters): RestaurantQueryFilters {
  const q: RestaurantQueryFilters = { sort: f.sort }
  if (f.categorySlug) q.categorySlug = f.categorySlug
  if (f.fulfillment) q.fulfillment = f.fulfillment
  if (f.minRating !== undefined) q.minRating = f.minRating
  if (f.priceTiers && f.priceTiers.length > 0) q.priceTiers = f.priceTiers
  return q
}

// ---------- definição semântica ----------

/**
 * Define o que "satisfaz os filtros". Cidade e tipo (restaurante) ficam fora: são escopo da
 * consulta. Como `BusinessSummary` só tem `categoryId`, quem chama resolve o slug em id.
 * Com `categorySlug` e sem `categoryId` resolvido, nada casa (categoria inexistente).
 */
export function matchesFilters(b: BusinessSummary, f: RestaurantQueryFilters, categoryId?: string): boolean {
  if (f.categorySlug && (categoryId === undefined || b.categoryId !== categoryId)) return false
  if (f.fulfillment === 'delivery' && b.deliveryOffer === 'none') return false
  if (f.fulfillment === 'pickup' && !b.acceptsPickup) return false
  if (f.minRating !== undefined && !(b.ratingAvg >= f.minRating)) return false
  if (f.priceTiers && f.priceTiers.length > 0 && (b.priceTier === null || !f.priceTiers.includes(b.priceTier))) {
    return false
  }
  return true
}

function nullsLast(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}

/** Ordenação com desempate estável por id. Proximidade usa a distância ESTIMADA (nulos por último). */
export function compareBy(sort: RestaurantSort): (a: BusinessSummary, b: BusinessSummary) => number {
  const byId = (a: BusinessSummary, b: BusinessSummary) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return (a, b) => {
    let primary: number
    switch (sort) {
      case 'proximity':
        primary = nullsLast(a.distanceEstimateKm, b.distanceEstimateKm)
        break
      case 'delivery_time':
        primary = nullsLast(a.estimatedMinMinutes, b.estimatedMinMinutes)
        break
      default:
        primary = b.popularityScore - a.popularityScore
    }
    return primary !== 0 ? primary : byId(a, b)
  }
}

// ---------- especificação de consulta ----------

export interface QuerySpec {
  eq: [string, unknown][]
  gte: [string, number][]
  in: [string, unknown[]][]
  notNull: string[]
  order: [string, 'asc' | 'desc'][]
}

/**
 * Traduz filtros para a consulta da visão `public_businesses` (colunas em snake_case).
 * Asc ordena nulos por último (padrão do Postgres), igual a `compareBy`.
 */
export function toQuerySpec(f: RestaurantQueryFilters, cityId: string, categoryId?: string): QuerySpec {
  const spec: QuerySpec = {
    eq: [
      ['city_id', cityId],
      ['business_type', 'restaurante'],
    ],
    gte: [],
    in: [],
    notNull: [],
    order: [],
  }
  if (f.categorySlug) {
    if (categoryId === undefined) spec.in.push(['category_id', []])
    else spec.eq.push(['category_id', categoryId])
  }
  if (f.fulfillment === 'delivery') spec.in.push(['delivery_offer', ['partner', 'own']])
  if (f.fulfillment === 'pickup') spec.eq.push(['accepts_pickup', true])
  if (f.minRating !== undefined) spec.gte.push(['rating_avg', f.minRating])
  if (f.priceTiers && f.priceTiers.length > 0) spec.in.push(['price_tier', [...f.priceTiers]])

  switch (f.sort ?? DEFAULT_SORT) {
    case 'proximity':
      spec.order.push(['distance_estimate_km', 'asc'])
      break
    case 'delivery_time':
      spec.order.push(['estimated_min_minutes', 'asc'])
      break
    default:
      spec.order.push(['popularity_score', 'desc'])
  }
  spec.order.push(['id', 'asc']) // desempate estável entre páginas
  return spec
}
