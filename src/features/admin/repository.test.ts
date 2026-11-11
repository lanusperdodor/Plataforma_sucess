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

describe('repositório administrativo', () => {
  it('admin_my_access é mapeado e canAdmin exige MFA ok + permissão', async () => {
    h.fake.handler = () => ({
      data: { is_master: false, is_operator: true, mfa_required: true, aal: 'aal1', mfa_ok: false, permissions: [] },
      error: null,
    })
    const access = await repo.getMyAccess()
    expect(h.fake.queries[0]).toMatchObject({ table: 'admin_my_access', op: 'rpc' })
    expect(access).toMatchObject({ isOperator: true, mfaOk: false })
    expect(repo.canAdmin(access, 'businesses.review')).toBe(false)
    expect(repo.canAdmin({ ...access, mfaOk: true, permissions: ['businesses.review'] }, 'businesses.review')).toBe(true)
    expect(repo.canAdmin({ ...access, mfaOk: false, permissions: ['businesses.review'] }, 'businesses.review')).toBe(false)
  })

  it('reviewBusiness envia decisão e motivo aparado; recusa do servidor vira erro legível', async () => {
    h.fake.handler = () => ({ data: 'rejected', error: null })
    await expect(repo.reviewBusiness('b1', 'reject', '  sem alvará  ')).resolves.toBe('rejected')
    expect(h.fake.queries[0]!.payload).toEqual({ _business: 'b1', _decision: 'reject', _note: 'sem alvará' })

    h.fake.handler = () => ({ data: null, error: { code: '42501', message: 'forbidden' } })
    await expect(repo.reviewBusiness('b1', 'approve')).rejects.toMatchObject({ code: 'forbidden' })
    h.fake.handler = () => ({ data: null, error: { code: 'P0001', message: 'Informe o motivo.' } })
    await expect(repo.reviewBusiness('b1', 'suspend')).rejects.toMatchObject({ code: 'business_rule', message: 'Informe o motivo.' })
  })

  it('listBusinesses pagina e normaliza filtro', async () => {
    h.fake.handler = () => ({
      data: [{
        id: 'b1', name: 'Pizzaria', slug: 'pizzaria', status: 'pending', business_type: 'restaurante',
        city_name: 'Itaú de Minas', city_state: 'MG', category_label: 'Pizzas', owner_id: 'u1',
        owner_email: 'dono@x.com', owner_name: 'Dono', phone: null, description: null, address_line: null,
        submitted_at: '2026-11-10T12:00:00Z', reviewed_at: null, review_note: null, created_at: '2026-11-10T12:00:00Z',
      }],
      error: null,
    })
    const rows = await repo.listBusinesses('pending', '  pizza ', 2, 20)
    expect(h.fake.queries[0]!.payload).toEqual({ _status: 'pending', _search: 'pizza', _limit: 20, _offset: 40 })
    expect(rows[0]).toMatchObject({ city: 'Itaú de Minas, MG', ownerEmail: 'dono@x.com', status: 'pending' })
  })

  it('dados fora do formato não são exibidos como válidos', async () => {
    h.fake.handler = () => ({ data: { users_total: 'muitos' }, error: null })
    await expect(repo.getDashboard()).rejects.toMatchObject({ code: 'validation' })
  })

  it('função inexistente (migration não aplicada) sinaliza dependência, sem dados fictícios', async () => {
    h.fake.handler = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    await expect(repo.getDashboard()).rejects.toMatchObject({ code: 'unavailable' })
  })
})
