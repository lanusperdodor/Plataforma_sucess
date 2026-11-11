import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  signIn: vi.fn(),
}))
vi.mock('../../lib/supabase.ts', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: h.rpc, auth: { signInWithPassword: h.signIn } },
}))
const { signInWithIdentifier } = await import('./signIn')
afterEach(() => vi.clearAllMocks())

describe('login com e-mail ou usuário', () => {
  it('e-mail vai direto ao Supabase Auth (sem consultar usuário)', async () => {
    h.signIn.mockResolvedValue({ error: null })
    await expect(signInWithIdentifier(' Ana@Exemplo.com ', 's')).resolves.toEqual({ error: null })
    expect(h.rpc).not.toHaveBeenCalled()
    expect(h.signIn).toHaveBeenCalledWith({ email: 'ana@exemplo.com', password: 's' })
  })
  it('usuário (qualquer caixa) é trocado pelo e-mail devolvido pelo banco', async () => {
    h.rpc.mockResolvedValue({ data: 'admin@tucai.example.com', error: null })
    h.signIn.mockResolvedValue({ error: null })
    await signInWithIdentifier('ADMIN', 'senha-qualquer')
    expect(h.rpc).toHaveBeenCalledWith('resolve_login', { _username: 'ADMIN', _password: 'senha-qualquer' })
    expect(h.signIn).toHaveBeenCalledWith({ email: 'admin@tucai.example.com', password: 'senha-qualquer' })
  })
  it('senha errada: mensagem genérica; excesso de tentativas: aviso próprio', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null })
    h.signIn.mockResolvedValue({ error: { code: 'invalid_credentials' } })
    await expect(signInWithIdentifier('ana.souza', 'x')).resolves.toEqual({ error: 'invalid' })
    h.rpc.mockResolvedValue({ data: null, error: { code: 'PT429' } })
    await expect(signInWithIdentifier('ana.souza', 'x')).resolves.toEqual({ error: 'rate_limited' })
  })
})
