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

describe('direitos do titular', () => {
  it('envia a solicitação pela RPC com detalhes vazios como null', async () => {
    h.fake.handler = () => ({ data: 'r1', error: null })
    await expect(repo.submitPrivacyRequest('deletion', '   ')).resolves.toBe('r1')
    expect(h.fake.queries[0]).toMatchObject({ table: 'submit_privacy_request', op: 'rpc', payload: { _kind: 'deletion', _details: null } })
  })
  it('limite do servidor (PT429) vira mensagem legível de espera', async () => {
    h.fake.handler = () => ({ data: null, error: { code: 'PT429', message: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.' } })
    await expect(repo.exportMyData()).rejects.toMatchObject({ code: 'rate_limited', message: expect.stringContaining('Aguarde') })
  })
  it('lista só as solicitações do próprio usuário', async () => {
    h.fake.handler = () => ({
      data: [{ id: 'r1', kind: 'access', details: null, status: 'completed', resolution_note: 'Enviado.', resolved_at: '2026-11-11T10:00:00Z', created_at: '2026-11-10T10:00:00Z' }],
      error: null,
    })
    const rows = await repo.listMyPrivacyRequests('u1')
    expect(h.fake.queries[0]).toMatchObject({ table: 'privacy_requests', eq: { user_id: 'u1' } })
    expect(rows[0]).toMatchObject({ status: 'completed', resolutionNote: 'Enviado.' })
  })
  it('atendimento envia confirmação explícita de anonimização', async () => {
    h.fake.handler = () => ({ data: null, error: null })
    await repo.adminResolvePrivacyRequest('r1', 'completed', ' feito ', true)
    expect(h.fake.queries[0]!.payload).toEqual({ _request: 'r1', _status: 'completed', _note: 'feito', _anonymize: true })
  })
  it('texto acima de 2000 caracteres é recusado antes de enviar', async () => {
    await expect(repo.submitPrivacyRequest('access', 'x'.repeat(2001))).rejects.toThrow()
    expect(h.fake.queries).toHaveLength(0)
  })
})
