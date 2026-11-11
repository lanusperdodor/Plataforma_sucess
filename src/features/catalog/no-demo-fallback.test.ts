import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FakeSupabase } from '../../test/fakeSupabase'

const h = vi.hoisted(() => ({ fake: null as unknown as FakeSupabase }))
vi.mock('../../lib/supabase', async () => {
  const { createFakeSupabase } = await import('../../test/fakeSupabase')
  h.fake = createFakeSupabase()
  return { isSupabaseConfigured: true, supabase: h.fake.supabase }
})
const repo = await import('./repository')

afterEach(() => h.fake.reset())

describe('catálogo sem dados fictícios', () => {
  it('tabela inexistente (PGRST205) NÃO vira demonstração: sinaliza serviço indisponível', async () => {
    h.fake.handler = () => ({ data: null, error: { code: 'PGRST205', message: 'relation not found' } })
    await expect(repo.listCities()).rejects.toMatchObject({ code: 'unavailable' })
    await expect(repo.listRestaurants('c1')).rejects.toMatchObject({ code: 'unavailable' })
  })
  it('erro de rede continua sendo erro de rede', async () => {
    h.fake.handler = () => ({ data: null, error: { message: 'Failed to fetch' } })
    await expect(repo.listCities()).rejects.toMatchObject({ code: 'network' })
  })
  it('banco vazio devolve listas vazias (a UI mostra estado vazio)', async () => {
    h.fake.handler = () => ({ data: [], error: null })
    await expect(repo.listCities()).resolves.toEqual([])
    await expect(repo.listFeatured('c1')).resolves.toEqual([])
  })
  it('consultas não pedem a coluna is_demo', async () => {
    h.fake.handler = () => ({ data: [], error: null })
    await repo.listCities()
    await repo.listRestaurants('c1')
    expect(h.fake.queries.every((q) => !q.columns.includes('is_demo'))).toBe(true)
  })
})
