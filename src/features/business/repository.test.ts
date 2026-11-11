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

const valid = { name: 'Pizzaria Boa', businessType: 'restaurante' as const, cityId: 'c1', categoryId: '', phone: '', addressLine: '', description: '' }

describe('solicitação de cadastro de estabelecimento', () => {
  it('valida campos antes de enviar', () => {
    expect(repo.applicationSchema.safeParse({ ...valid, name: 'X' }).success).toBe(false)
    expect(repo.applicationSchema.safeParse({ ...valid, cityId: '' }).success).toBe(false)
    expect(repo.applicationSchema.safeParse({ ...valid, phone: 'abc' }).success).toBe(false)
    expect(repo.applicationSchema.safeParse({ ...valid, phone: '(35) 99999-0000' }).success).toBe(true)
    expect(repo.applicationSchema.safeParse(valid).success).toBe(true)
  })

  it('envia para submit_business_application com campos vazios como null', async () => {
    h.fake.handler = () => ({ data: 'new-id', error: null })
    await expect(repo.submitApplication({ ...valid, name: '  Pizzaria Boa ' })).resolves.toBe('new-id')
    expect(h.fake.queries[0]).toMatchObject({ table: 'submit_business_application', op: 'rpc' })
    expect(h.fake.queries[0]!.payload).toEqual({
      _name: 'Pizzaria Boa', _business_type: 'restaurante', _city_id: 'c1',
      _category_id: null, _phone: null, _description: null, _address_line: null,
    })
  })

  it('regra do servidor (limite de solicitações) chega como mensagem legível', async () => {
    h.fake.handler = () => ({ data: null, error: { code: 'P0001', message: 'Você já tem solicitações em análise.' } })
    await expect(repo.submitApplication(valid)).rejects.toMatchObject({ code: 'business_rule', message: 'Você já tem solicitações em análise.' })
  })

  it('lista apenas os negócios do próprio usuário', async () => {
    h.fake.handler = () => ({
      data: [{ id: 'b1', name: 'Pizzaria Boa', slug: 'pizzaria-boa', status: 'rejected', business_type: 'restaurante',
               submitted_at: null, reviewed_at: '2026-11-10T00:00:00Z', review_note: 'Falta CNPJ', created_at: '2026-11-09T00:00:00Z' }],
      error: null,
    })
    const rows = await repo.listMyBusinesses('u1')
    expect(h.fake.queries[0]).toMatchObject({ table: 'businesses', eq: { owner_id: 'u1' } })
    expect(rows[0]).toMatchObject({ status: 'rejected', reviewNote: 'Falta CNPJ', submittedAt: '2026-11-09T00:00:00Z' })
  })
})
