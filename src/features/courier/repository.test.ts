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

const moto = { fullName: 'Ana Souza', phone: '(35) 99999-0000', cityId: 'c1', vehicle: 'moto' as const, plate: 'abc-1d23', cnh: 'a', acceptTerms: true }

describe('cadastro de entregador', () => {
  it('exige termos, placa e CNH válidas para veículos motorizados', () => {
    expect(repo.courierFormSchema.safeParse({ ...moto, acceptTerms: false }).success).toBe(false)
    expect(repo.courierFormSchema.safeParse({ ...moto, plate: 'XX1' }).success).toBe(false)
    expect(repo.courierFormSchema.safeParse({ ...moto, cnh: 'Z' }).success).toBe(false)
    expect(repo.courierFormSchema.safeParse({ ...moto, vehicle: 'bicicleta', plate: '', cnh: '' }).success).toBe(true)
  })
  it('normaliza placa e CNH e descarta ambos para bicicleta', () => {
    expect(repo.courierFormToArgs(moto)).toMatchObject({ _vehicle_plate: 'ABC1D23', _cnh_category: 'A', _accept_terms: true })
    expect(repo.courierFormToArgs({ ...moto, vehicle: 'bicicleta' })).toMatchObject({ _vehicle_plate: null, _cnh_category: null })
  })
  it('envia pela função do servidor e mostra o limite de tentativas', async () => {
    h.fake.handler = () => ({ data: 'pending', error: null })
    await expect(repo.submitCourierApplication(moto)).resolves.toBe('pending')
    expect(h.fake.queries[0]).toMatchObject({ table: 'submit_courier_application', op: 'rpc' })
    h.fake.handler = () => ({ data: null, error: { code: 'PT429', message: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.' } })
    await expect(repo.submitCourierApplication(moto)).rejects.toMatchObject({ code: 'rate_limited' })
  })
})
