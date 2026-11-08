import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FakeSupabase } from '../../test/fakeSupabase'
import { normalize, qk } from './keys'
import { businessRowSchema } from './schemas'

const h = vi.hoisted(() => ({ fake: null as unknown as FakeSupabase }))

vi.mock('../../lib/supabase', async () => {
  const { createFakeSupabase } = await import('../../test/fakeSupabase')
  h.fake = createFakeSupabase()
  return { isSupabaseConfigured: true, supabase: h.fake.supabase }
})

const repo = await import('./repository')

function businessRow(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `b${i}`,
    name: `Rest ${i}`,
    slug: `rest-${i}`,
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
    distance_estimate_km: 1.5,
    delivery_offer: 'partner',
    own_delivery_fee_cents: 0,
    accepts_pickup: true,
    estimated_min_minutes: 30,
    estimated_max_minutes: 45,
    min_order_cents: 0,
    price_tier: 2,
    rating_avg: 4.5,
    rating_count: 10,
    popularity_score: 5,
    is_featured: false,
    is_demo: true,
    is_open: true,
    ...over,
  }
}

beforeEach(() => {
  h.fake.reset()
  h.fake.handler = () => ({ data: [], error: null })
})

describe('schemas', () => {
  it('mapeia snake_case para camelCase expondo isDemo e distanceEstimateKm', () => {
    const b = businessRowSchema.parse(businessRow(1))
    expect(b).toMatchObject({
      businessType: 'restaurante',
      isDemo: true,
      distanceEstimateKm: 1.5,
      acceptsPickup: true,
      deliveryOffer: 'partner',
      ratingAvg: 4.5,
      isOpen: true,
    })
    expect(b.distanceKm).toBeUndefined()
  })
})

describe('keys', () => {
  it('normalize ordena chaves, remove vazios e padrão', () => {
    const a = normalize({ sort: 'popularity', priceTiers: [3, 1], categorySlug: 'pizza', x: false, y: [] }, { sort: 'popularity' })
    const b = normalize({ categorySlug: 'pizza', priceTiers: [1, 3] })
    expect(a).toEqual(b)
    expect(Object.keys(a)).toEqual(['categorySlug', 'priceTiers'])
    expect(qk.restaurants('c', { b: 1, a: 2 })).toEqual(qk.restaurants('c', { a: 2, b: 1 }))
  })
})

describe('repository', () => {
  it('listRestaurants lê public_businesses com filtros e pede 13 linhas', async () => {
    h.fake.handler = () => ({ data: Array.from({ length: 13 }, (_, i) => businessRow(i)), error: null })
    const page = await repo.listRestaurants('city1', { fulfillment: 'pickup', minRating: 4, priceTiers: [1, 2] }, 1)
    const q = h.fake.queries[0]!
    expect(q.table).toBe('public_businesses')
    expect(q.eq).toMatchObject({ city_id: 'city1', accepts_pickup: true })
    expect(q.filters).toContainEqual({ kind: 'gte', column: 'rating_avg', value: 4 })
    expect(q.filters).toContainEqual({ kind: 'in', column: 'price_tier', value: [1, 2] })
    expect(q.range).toEqual({ from: 12, to: 24 })
    expect(page.items).toHaveLength(12)
    expect(page.hasMore).toBe(true)
    expect(page.nextPage).toBe(2)
    expect(page.items[0]!.isDemo).toBe(true)
  })

  it('listFeatured usa a visão e is_featured', async () => {
    await repo.listFeatured('city1')
    expect(h.fake.queries[0]!.table).toBe('public_businesses')
    expect(h.fake.queries[0]!.eq).toMatchObject({ city_id: 'city1', is_featured: true })
  })

  it('listCategories filtra por kind', async () => {
    await repo.listCategories('restaurante')
    expect(h.fake.queries[0]).toMatchObject({ table: 'categories', eq: { kind: 'restaurante' } })
  })

  it('resposta malformada vira RepositoryError validation', async () => {
    h.fake.handler = () => ({ data: [{ id: 1 }], error: null })
    await expect(repo.listRestaurants('city1')).rejects.toMatchObject({ code: 'validation' })
    await expect(repo.listCities()).rejects.toMatchObject({ code: 'validation' })
  })

  it('erro de rede vira RepositoryError network', async () => {
    h.fake.handler = () => ({ data: null, error: { message: 'Failed to fetch' } })
    await expect(repo.listCities()).rejects.toMatchObject({ code: 'network' })
    h.fake.handler = () => {
      throw new TypeError('Failed to fetch')
    }
    await expect(repo.listFeatured('city1')).rejects.toMatchObject({ code: 'network' })
  })
})
