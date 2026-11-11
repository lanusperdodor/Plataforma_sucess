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

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'

describe('Conectuaí', () => {
  it('filtros or() só aceitam UUID (sem injeção no filtro)', async () => {
    await expect(repo.getFriendState(A, `${B}),or(id.not.is.null`)).rejects.toMatchObject({ code: 'validation' })
    expect(h.fake.queries).toHaveLength(0)
  })
  it('estado de amizade a partir do vínculo', async () => {
    h.fake.handler = () => ({ data: [{ requester_id: B, addressee_id: A, status: 'pending' }], error: null })
    await expect(repo.getFriendState(A, B)).resolves.toBe('received')
    h.fake.handler = () => ({ data: [{ requester_id: A, addressee_id: B, status: 'accepted' }], error: null })
    await expect(repo.getFriendState(A, B)).resolves.toBe('friends')
  })
  it('valida recado, depoimento, comunidade e tópico antes de enviar', () => {
    expect(repo.scrapBody.safeParse('  ').success).toBe(false)
    expect(repo.testimonialBody.safeParse('curto').success).toBe(false)
    expect(repo.communityFormSchema.safeParse({ name: 'Oi', description: '', rules: '', category: 'cidade', cityId: '', isPrivate: false, avatarUrl: '' }).success).toBe(false)
    expect(repo.communityFormSchema.safeParse({ name: 'Motociclistas', description: '', rules: '', category: 'veiculos', cityId: '', isPrivate: true, avatarUrl: 'javascript:x' }).success).toBe(false)
    expect(repo.topicFormSchema.safeParse({ title: 'Ok', body: 'x' }).success).toBe(false)
  })
  it('enquete precisa de 2 a 6 opções', async () => {
    await expect(repo.createPoll('c1', 'Melhor dia?', ['Sábado', ' '], 7)).rejects.toMatchObject({ code: 'validation' })
    expect(h.fake.queries).toHaveLength(0)
  })
  it('sair da comunidade sem permissão (dona) vira mensagem clara', async () => {
    h.fake.handler = () => ({ data: [], error: null })
    await expect(repo.leaveCommunity('c1', A)).rejects.toMatchObject({ code: 'forbidden', message: expect.stringContaining('transferir') })
  })
  it('busca de comunidades remove curingas do termo', async () => {
    h.fake.handler = () => ({ data: [], error: null })
    await repo.listCommunities({ search: '50%_off,(x)' })
    expect(h.fake.queries[0]!.filters).toContainEqual({ kind: 'ilike', column: 'name', value: '%50offx%' })
  })
})
