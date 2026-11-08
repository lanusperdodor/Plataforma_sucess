import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { applySpec } from '../../test/applySpec'
import {
  compareBy,
  matchesFilters,
  MIN_RATINGS,
  parseRestaurantFilters,
  serializeRestaurantFilters,
  toQuerySpec,
  type RestaurantFilters,
} from './filters'
import { businessRowSchema, type BusinessSummary } from './schemas'

function biz(i: number, over: Record<string, unknown> = {}): BusinessSummary {
  return businessRowSchema.parse({
    id: `b${String(i).padStart(3, '0')}`,
    name: `R${i}`,
    slug: `r-${i}`,
    business_type: 'restaurante',
    category_id: 'c1',
    city_id: 'city1',
    description: null,
    cover_url: null,
    logo_url: null,
    address_line: null,
    phone: null,
    whatsapp: null,
    lat: null,
    lng: null,
    distance_estimate_km: 1,
    delivery_offer: 'partner',
    own_delivery_fee_cents: 0,
    accepts_pickup: true,
    estimated_min_minutes: 30,
    estimated_max_minutes: 45,
    min_order_cents: 0,
    price_tier: 2,
    rating_avg: 4,
    rating_count: 1,
    popularity_score: 1,
    is_featured: false,
    is_demo: true,
    is_open: true,
    ...over,
  })
}

describe('parse/serialize', () => {
  it('entrada inválida vira padrão', () => {
    const f = parseRestaurantFilters(
      new URLSearchParams('sort=xyz&modo=voar&nota=5&preco=0,9,x&categoria=%20'),
    )
    expect(f).toEqual({ sort: 'popularity' })
  })

  it('lê valores válidos e serializa de forma canônica', () => {
    const f = parseRestaurantFilters(
      new URLSearchParams('categoria=pizza&modo=pickup&nota=3.5&preco=3,1&sort=proximity'),
    )
    expect(f).toEqual({ categorySlug: 'pizza', fulfillment: 'pickup', minRating: 3.5, priceTiers: [1, 3], sort: 'proximity' })
    expect(serializeRestaurantFilters(f).toString()).toBe('categoria=pizza&modo=pickup&nota=3.5&preco=1%2C3&sort=proximity')
    expect(serializeRestaurantFilters({ sort: 'popularity' }).toString()).toBe('')
  })

  it('ida e volta preserva os filtros', () => {
    const arb = fc.record(
      {
        categorySlug: fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
        fulfillment: fc.constantFrom('delivery' as const, 'pickup' as const),
        minRating: fc.constantFrom(...MIN_RATINGS),
        priceTiers: fc
          .subarray([1, 2, 3, 4] as const, { minLength: 1 })
          .map((a) => [...a] as (1 | 2 | 3 | 4)[]),
        sort: fc.constantFrom('proximity' as const, 'popularity' as const, 'delivery_time' as const),
      },
      { requiredKeys: ['sort'] },
    )
    fc.assert(
      fc.property(arb, (f) => {
        expect(parseRestaurantFilters(serializeRestaurantFilters(f as RestaurantFilters))).toEqual(f)
      }),
    )
  })
})

describe('matchesFilters', () => {
  it('delivery exclui quem não entrega; pickup exige retirada', () => {
    const none = biz(1, { delivery_offer: 'none' })
    expect(matchesFilters(none, { fulfillment: 'delivery' })).toBe(false)
    expect(matchesFilters(biz(2, { delivery_offer: 'own' }), { fulfillment: 'delivery' })).toBe(true)
    expect(matchesFilters(biz(3, { accepts_pickup: false }), { fulfillment: 'pickup' })).toBe(false)
  })

  it('nota mínima, faixa de preço (nulo não casa) e categoria', () => {
    expect(matchesFilters(biz(1, { rating_avg: 3.9 }), { minRating: 4 })).toBe(false)
    expect(matchesFilters(biz(1, { rating_avg: 4 }), { minRating: 4 })).toBe(true)
    expect(matchesFilters(biz(1, { price_tier: null }), { priceTiers: [1, 2] })).toBe(false)
    expect(matchesFilters(biz(1), { priceTiers: [2] })).toBe(true)
    expect(matchesFilters(biz(1), { categorySlug: 'x' }, 'c1')).toBe(true)
    expect(matchesFilters(biz(1), { categorySlug: 'x' }, 'c2')).toBe(false)
    expect(matchesFilters(biz(1), { categorySlug: 'x' })).toBe(false)
  })
})

describe('compareBy', () => {
  it('proximidade: menor primeiro, nulos por último, desempate por id', () => {
    const list = [biz(3, { distance_estimate_km: null }), biz(2, { distance_estimate_km: 2 }), biz(1, { distance_estimate_km: 2 }), biz(4, { distance_estimate_km: 0.5 })]
    expect(list.sort(compareBy('proximity')).map((b) => b.id)).toEqual(['b004', 'b001', 'b002', 'b003'])
  })

  it('popularidade: maior primeiro; tempo de entrega: menor primeiro', () => {
    const list = [biz(1, { popularity_score: 1, estimated_min_minutes: 40 }), biz(2, { popularity_score: 9, estimated_min_minutes: null }), biz(3, { popularity_score: 5, estimated_min_minutes: 20 })]
    expect([...list].sort(compareBy('popularity')).map((b) => b.id)).toEqual(['b002', 'b003', 'b001'])
    expect([...list].sort(compareBy('delivery_time')).map((b) => b.id)).toEqual(['b003', 'b001', 'b002'])
  })
})

describe('toQuerySpec (equivalência com a definição semântica)', () => {
  const bizArb = fc
    .record({
      distance_estimate_km: fc.option(fc.integer({ min: 0, max: 5 }), { nil: null }),
      estimated_min_minutes: fc.option(fc.integer({ min: 10, max: 60 }), { nil: null }),
      popularity_score: fc.integer({ min: 0, max: 5 }),
      rating_avg: fc.constantFrom(0, 2.9, 3, 3.5, 4, 4.4, 4.5, 5),
      price_tier: fc.option(fc.constantFrom(1, 2, 3, 4), { nil: null }),
      delivery_offer: fc.constantFrom('partner', 'own', 'none'),
      accepts_pickup: fc.boolean(),
      category_id: fc.constantFrom('c1', 'c2', null),
    })
    .map((over) => over)
  const listArb = fc.array(bizArb, { maxLength: 15 }).map((l) => l.map((o, i) => biz(i, o)))
  const filtersArb = fc.record(
    {
      categorySlug: fc.constant('cat'),
      fulfillment: fc.constantFrom('delivery' as const, 'pickup' as const),
      minRating: fc.constantFrom(...MIN_RATINGS),
      priceTiers: fc.subarray([1, 2, 3, 4] as const).map((a) => [...a] as (1 | 2 | 3 | 4)[]),
      sort: fc.constantFrom('proximity' as const, 'popularity' as const, 'delivery_time' as const),
    },
    { requiredKeys: ['sort'] },
  )

  it('applySpec == filter(matchesFilters).sort(compareBy)', () => {
    fc.assert(
      fc.property(listArb, filtersArb, fc.constantFrom<string | undefined>('c1', 'c9', undefined), (list, f, catId) => {
        const expected = list.filter((b) => matchesFilters(b, f, catId)).sort(compareBy(f.sort))
        expect(applySpec(list, toQuerySpec(f, 'city1', catId))).toEqual(expected)
      }),
    )
  })

  it('escopo de cidade e tipo fica na especificação', () => {
    const list = [biz(1), biz(2, { city_id: 'outra' }), biz(3, { business_type: 'loja' })]
    expect(applySpec(list, toQuerySpec({}, 'city1')).map((b) => b.id)).toEqual(['b001'])
  })
})
