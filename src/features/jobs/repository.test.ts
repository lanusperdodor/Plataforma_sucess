import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FakeSupabase } from '../../test/fakeSupabase'
import { formatBRL } from '../../lib/money'

const h = vi.hoisted(() => ({ fake: null as unknown as FakeSupabase }))
vi.mock('../../lib/supabase', async () => {
  const { createFakeSupabase } = await import('../../test/fakeSupabase')
  h.fake = createFakeSupabase()
  return { isSupabaseConfigured: true, supabase: h.fake.supabase }
})
const repo = await import('./repository')
afterEach(() => h.fake.reset())

const job = { title: 'Caixa', area: 'atendimento' as const, description: 'Atendimento no caixa, turno da tarde.', requirements: '', benefits: '', employment: 'clt' as const, workMode: 'presencial' as const, salaryMin: '1.800,00', salaryMax: '2.200', openings: '2', days: '30' }

describe('vagas', () => {
  it('converte salários para centavos e valida faixa', () => {
    expect(repo.jobFormToArgs('b1', job, null)).toMatchObject({ _salary_min_cents: 180000, _salary_max_cents: 220000, _openings: 2, _job: null })
    expect(repo.jobFormSchema.safeParse({ ...job, salaryMax: '1.000' }).success).toBe(false)
    expect(repo.jobFormSchema.safeParse({ ...job, days: '120' }).success).toBe(false)
    expect(repo.jobFormSchema.safeParse({ ...job, description: 'curta' }).success).toBe(false)
  })
  it('texto de salário', () => {
    expect(repo.salaryText({ salaryMinCents: null, salaryMaxCents: null }, formatBRL)).toBe('A combinar')
    expect(repo.salaryText({ salaryMinCents: 150000, salaryMaxCents: null }, formatBRL)).toBe('R$ 1.500,00')
    expect(repo.salaryText({ salaryMinCents: 150000, salaryMaxCents: 200000 }, formatBRL)).toBe('R$ 1.500,00 a R$ 2.000,00')
  })
  it('candidatura vai pela função do servidor', async () => {
    h.fake.handler = () => ({ data: 'app-1', error: null })
    await expect(repo.applyToJob('j1', { fullName: 'Ana Souza', phone: '35999990000', message: '', experience: '' })).resolves.toBe('app-1')
    expect(h.fake.queries[0]).toMatchObject({ table: 'apply_to_job', op: 'rpc', payload: { _job: 'j1', _message: null } })
  })
})
