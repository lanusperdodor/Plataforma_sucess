import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

// ---------- cliente Supabase falso (controla eventos de sessão e respostas do banco) ----------
type Q = { table: string; op: 'select' | 'update'; filters: Record<string, unknown>; payload?: unknown }
type Result = { data: unknown; error: unknown }

const fake = vi.hoisted(() => {
  const state = {
    listener: null as null | ((event: string, session: unknown) => void),
    handler: (() => Promise.resolve({ data: [], error: null })) as (q: Q) => Promise<Result> | Result,
  }
  const auth = {
    onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
      state.listener = cb
      return { data: { subscription: { unsubscribe: () => (state.listener = null) } } }
    },
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
  }
  const from = (table: string) => {
    const q: Q = { table, op: 'select', filters: {} }
    const b = {
      select: () => b,
      single: () => b,
      eq: (k: string, v: unknown) => ((q.filters[k] = v), b),
      update: (p: unknown) => ((q.op = 'update'), (q.payload = p), b),
      then: (res: (r: Result) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(state.handler(q)).then(res, rej),
    }
    return b
  }
  return { state, supabase: { auth, from } }
})

vi.mock('../../lib/supabase.ts', () => ({ isSupabaseConfigured: true, supabase: fake.supabase }))

import { AuthProvider, useAuth } from './AuthProvider.tsx'
import { RequireAuth } from './RequireAuth.tsx'
import { LoginPage, NewPasswordPage, ResetPasswordPage, SignUpPage, safeRedirect } from '../../pages/AuthPages.tsx'
import { AccountPage } from '../../pages/AccountPage.tsx'
import { newPasswordSchema } from './schemas.ts'

const sess = (id: string, email = `${id}@teste.invalid`) => ({ user: { id, email } })
const emit = (event: string, session: unknown) => act(() => fake.state.listener!(event, session))

function Where() {
  const l = useLocation()
  return <span data-testid="where">{l.pathname}</span>
}
function Roles() {
  const { authz, authzError } = useAuth()
  return <span data-testid="roles">{authzError ? 'ERRO' : (authz?.roles.join(',') ?? 'nenhum')}</span>
}
function renderApp(path: string, extra?: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Where />
        <Roles />
        {extra}
        <Routes>
          <Route path="/entrar" element={<LoginPage />} />
          <Route path="/cadastro" element={<SignUpPage />} />
          <Route path="/recuperar-senha" element={<ResetPasswordPage />} />
          <Route path="/nova-senha" element={<NewPasswordPage />} />
          <Route path="/conta" element={<RequireAuth><AccountPage /></RequireAuth>} />
          <Route path="/master" element={<RequireAuth role="platform_master"><p>área master</p></RequireAuth>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

/** Handler padrão: papel customer e perfil preenchido para qualquer usuário. */
function defaultDb(q: Q): Result {
  if (q.table === 'user_roles') return { data: [{ role: 'customer' }], error: null }
  if (q.table === 'business_members') return { data: [], error: null }
  if (q.table === 'profiles' && q.op === 'select') return { data: { full_name: 'Ana', phone: '' }, error: null }
  if (q.table === 'profiles' && q.op === 'update') return { data: [{ id: q.filters.id }], error: null }
  return { data: null, error: { message: 'tabela inesperada' } }
}

beforeEach(() => {
  fake.state.handler = defaultDb
  Object.values(fake.supabase.auth).forEach((f) => 'mockReset' in f && f.mockReset())
})
afterEach(cleanup)

describe('sessão e papéis (AuthProvider)', () => {
  it('troca de usuário descarta resposta atrasada do usuário anterior', async () => {
    let releaseA!: () => void
    fake.state.handler = (q) => {
      if (q.table === 'user_roles' && q.filters.user_id === 'a') {
        return new Promise((r) => (releaseA = () => r({ data: [{ role: 'platform_master' }], error: null })))
      }
      return defaultDb(q)
    }
    renderApp('/conta')
    emit('SIGNED_IN', sess('a'))
    await waitFor(() => expect(releaseA).toBeTypeOf('function'))
    emit('SIGNED_IN', sess('b'))
    await waitFor(() => expect(screen.getByTestId('roles')).toHaveTextContent('customer'))
    await act(async () => releaseA())
    expect(screen.getByTestId('roles')).toHaveTextContent('customer') // não virou master
  })

  it('falha ao carregar papéis não é tratada como "sem papéis"', async () => {
    fake.state.handler = (q) => (q.table === 'user_roles' ? { data: null, error: { message: 'rede' } } : defaultDb(q))
    renderApp('/master')
    emit('INITIAL_SESSION', sess('a'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível verificar suas permissões')
    expect(screen.queryByText('área master')).not.toBeInTheDocument()
  })

  it('rota com papel exigido bloqueia quem não tem o papel', async () => {
    renderApp('/master')
    emit('INITIAL_SESSION', sess('a'))
    expect(await screen.findByText(/não tem permissão/)).toBeInTheDocument()
  })

  it('sem sessão redireciona para /entrar', async () => {
    renderApp('/conta')
    emit('INITIAL_SESSION', null)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/entrar'))
  })
})

describe('login e cadastro', () => {
  it('login com sucesso volta para a rota de origem', async () => {
    fake.supabase.auth.signInWithPassword.mockResolvedValue({ error: null })
    renderApp('/conta')
    emit('INITIAL_SESSION', null)
    await screen.findByRole('heading', { name: 'Entrar' })
    type('E-mail', 'ana@exemplo.com')
    type('Senha', 'qualquer')
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    await waitFor(() => expect(fake.supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'ana@exemplo.com', password: 'qualquer' }))
    emit('SIGNED_IN', sess('a'))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/conta'))
  })

  it('login com e-mail não confirmado mostra orientação específica', async () => {
    fake.supabase.auth.signInWithPassword.mockResolvedValue({ error: { code: 'email_not_confirmed' } })
    renderApp('/entrar')
    emit('INITIAL_SESSION', null)
    type('E-mail', 'ana@exemplo.com')
    type('Senha', 'x')
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Confirme seu e-mail')
  })

  it('login com credencial errada mostra mensagem genérica', async () => {
    fake.supabase.auth.signInWithPassword.mockResolvedValue({ error: { code: 'invalid_credentials' } })
    renderApp('/entrar')
    emit('INITIAL_SESSION', null)
    type('E-mail', 'ana@exemplo.com')
    type('Senha', 'x')
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos.')
  })

  it('usuário já logado em /entrar segue para a conta', async () => {
    renderApp('/entrar')
    emit('INITIAL_SESSION', sess('a'))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/conta'))
  })

  it('safeRedirect só aceita caminhos internos', () => {
    expect(safeRedirect('/conta/pedidos')).toBe('/conta/pedidos')
    expect(safeRedirect('//evil.example')).toBe('/conta')
    expect(safeRedirect('https://evil.example')).toBe('/conta')
    expect(safeRedirect('/\\evil.example')).toBe('/conta')
    expect(safeRedirect(42)).toBe('/conta')
    expect(safeRedirect('/\t/evil.example')).toBe('/conta')
    expect(safeRedirect('/\n/evil.example')).toBe('/conta')
    expect(safeRedirect('javascript:alert(1)')).toBe('/conta')
    expect(safeRedirect('/conta?aba=a#topo')).toBe('/conta?aba=a#topo')
  })

  it('RequireAuth guarda pathname + search + hash em state.from', async () => {
    const From = () => {
      const l = useLocation()
      return <span data-testid="from">{String((l.state as { from?: unknown } | null)?.from)}</span>
    }
    renderApp('/conta?aba=pedidos&x=1#topo', <From />)
    emit('INITIAL_SESSION', null)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/entrar'))
    const from = screen.getByTestId('from').textContent
    expect(from).toBe('/conta?aba=pedidos&x=1#topo')
    expect(safeRedirect(from)).toBe(from)
  })

  it('cadastro envia nome nos metadados e pede confirmação de e-mail', async () => {
    fake.supabase.auth.signUp.mockResolvedValue({ data: { session: null }, error: null })
    renderApp('/cadastro')
    emit('INITIAL_SESSION', null)
    type('Nome completo', 'Ana Souza')
    type('E-mail', 'ana@exemplo.com')
    type('Senha', 'senhaForte123')
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Confirme seu e-mail')
    expect(fake.supabase.auth.signUp.mock.calls[0]?.[0]).toMatchObject({
      email: 'ana@exemplo.com',
      options: { data: { full_name: 'Ana Souza' } },
    })
  })

  it('cadastro sem confirmação de e-mail entra direto', async () => {
    fake.supabase.auth.signUp.mockResolvedValue({ data: { session: sess('a') }, error: null })
    renderApp('/cadastro')
    emit('INITIAL_SESSION', null)
    type('Nome completo', 'Ana Souza')
    type('E-mail', 'ana@exemplo.com')
    type('Senha', 'senhaForte123')
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    emit('SIGNED_IN', sess('a'))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/conta'))
  })
})

describe('recuperação de senha', () => {
  it('pedido de recuperação aponta para /nova-senha e não revela se a conta existe', async () => {
    fake.supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: { message: 'user not found' } })
    renderApp('/recuperar-senha')
    emit('INITIAL_SESSION', null)
    type('E-mail', 'ana@exemplo.com')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar instruções' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Se o e-mail existir')
    expect(fake.supabase.auth.resetPasswordForEmail.mock.calls[0]?.[1]?.redirectTo).toMatch(/\/nova-senha$/)
  })

  it('link de recuperação força a definição de senha nova antes de usar a conta', async () => {
    fake.supabase.auth.updateUser.mockResolvedValue({ error: null })
    renderApp('/conta')
    emit('PASSWORD_RECOVERY', sess('a'))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/nova-senha'))
    type('Nova senha', 'novaSenha2026')
    type('Confirme a nova senha', 'outraCoisa99')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar senha' }))
    expect(await screen.findByText('As senhas não conferem')).toBeInTheDocument()
    expect(fake.supabase.auth.updateUser).not.toHaveBeenCalled()

    type('Confirme a nova senha', 'novaSenha2026')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar senha' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/conta'))
    expect(fake.supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'novaSenha2026' })
    expect(await screen.findByText('Senha alterada.')).toBeInTheDocument()
  })

  it('erro ao salvar a senha nova é mostrado e mantém o usuário na tela', async () => {
    fake.supabase.auth.updateUser.mockResolvedValue({ error: { code: 'same_password' } })
    renderApp('/nova-senha')
    emit('PASSWORD_RECOVERY', sess('a'))
    await screen.findByLabelText('Nova senha')
    type('Nova senha', 'novaSenha2026')
    type('Confirme a nova senha', 'novaSenha2026')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar senha' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('diferente da anterior')
    expect(screen.getByTestId('where')).toHaveTextContent('/nova-senha')
  })

  it('/nova-senha sem sessão de recuperação informa link inválido', async () => {
    renderApp('/nova-senha')
    emit('INITIAL_SESSION', null)
    expect(await screen.findByText('Link inválido ou expirado.')).toBeInTheDocument()
  })

  it('schema exige senha forte e confirmação igual', () => {
    expect(newPasswordSchema.safeParse({ password: 'curta1', confirm: 'curta1' }).success).toBe(false)
    expect(newPasswordSchema.safeParse({ password: 'senhaForte123', confirm: 'senhaForte124' }).success).toBe(false)
    expect(newPasswordSchema.safeParse({ password: 'senhaForte123', confirm: 'senhaForte123' }).success).toBe(true)
  })
})

describe('perfil e logout', () => {
  it('carrega e salva o próprio perfil', async () => {
    const updates: Q[] = []
    fake.state.handler = (q) => (q.op === 'update' && updates.push(q), defaultDb(q))
    renderApp('/conta')
    emit('INITIAL_SESSION', sess('a'))
    await waitFor(() => expect(screen.getByLabelText('Nome completo')).toHaveValue('Ana'))
    type('Nome completo', 'Ana Souza')
    type('Telefone', '(35) 99999-0000')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Perfil salvo.')
    expect(updates[0]).toMatchObject({ filters: { id: 'a' }, payload: { full_name: 'Ana Souza', phone: '(35) 99999-0000' } })
  })

  it('update bloqueado (0 linhas) é reportado como falha', async () => {
    fake.state.handler = (q) => (q.op === 'update' ? { data: [], error: null } : defaultDb(q))
    renderApp('/conta')
    emit('INITIAL_SESSION', sess('a'))
    await waitFor(() => expect(screen.getByLabelText('Nome completo')).toHaveValue('Ana'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar.')
  })

  it('falha ao carregar o perfil é exibida e bloqueia salvar', async () => {
    fake.state.handler = (q) => (q.table === 'profiles' ? { data: null, error: { message: 'x' } } : defaultDb(q))
    renderApp('/conta')
    emit('INITIAL_SESSION', sess('a'))
    expect(await screen.findByText('Não foi possível carregar seu perfil.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })

  it('logout encerra a sessão local e volta ao login', async () => {
    fake.supabase.auth.signOut.mockResolvedValue({ error: null })
    renderApp('/conta')
    emit('INITIAL_SESSION', sess('a'))
    fireEvent.click(await screen.findByRole('button', { name: 'Sair' }))
    await waitFor(() => expect(fake.supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' }))
    emit('SIGNED_OUT', null)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/entrar'))
    expect(screen.getByTestId('roles')).toHaveTextContent('nenhum')
  })

  it('falha no logout é informada', async () => {
    fake.supabase.auth.signOut.mockResolvedValue({ error: { message: 'x' } })
    renderApp('/conta')
    emit('INITIAL_SESSION', sess('a'))
    fireEvent.click(await screen.findByRole('button', { name: 'Sair' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível sair')
  })
})
