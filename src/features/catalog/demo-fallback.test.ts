import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FakeSupabase } from '../../test/fakeSupabase'

const h = vi.hoisted(() => ({ fake: null as unknown as FakeSupabase }))
vi.mock('../../lib/supabase', async () => {
  const { createFakeSupabase } = await import('../../test/fakeSupabase')
  h.fake = createFakeSupabase()
  return { isSupabaseConfigured: true, supabase: h.fake.supabase }
})
const repo = await import('./repository')
const ds = await import('../../lib/data-source')

afterEach(() => ds.resetDataSourceForTests({ mode: 'remote', reason: null }))

describe('fallback para dados de demonstração', () => {
  it('tabela inexistente no Supabase (PGRST205) troca para demo, com tudo marcado isDemo', async () => {
    h.fake.handler = () => ({ data: null, error: { code: 'PGRST205', message: 'relation not found' } })
    const cities = await repo.listCities()
    expect(ds.getDataSource().mode).toBe('demo')
    expect(cities.every((c) => c.isDemo)).toBe(true)
    const page = await repo.listRestaurants(cities[0]!.id)
    expect(page.items.length).toBeGreaterThan(0)
    expect(page.items.every((b) => b.isDemo && b.name.includes('(demo)'))).toBe(true)
  })
  it('erro comum (rede) NÃO vira demonstração silenciosamente', async () => {
    h.fake.handler = () => ({ data: null, error: { message: 'Failed to fetch' } })
    await expect(repo.listCities()).rejects.toMatchObject({ code: 'network' })
    expect(ds.getDataSource().mode).toBe('remote')
  })
})