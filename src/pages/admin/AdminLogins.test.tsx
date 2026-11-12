import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ recovery: vi.fn(), created: vi.fn(), list: vi.fn(), password: vi.fn(), access: { isMaster: true, mfaOk: true, permissions: [] as string[] } }))
const account = (o: Record<string, unknown>) => ({ id: 'a1', email: 'ana@exemplo.com', fullName: 'Ana Real', username: 'ana', phone: null, roles: ['customer'], isTest: false, blocked: false, createdAt: '2026-11-01T10:00:00Z', lastSignInAt: null, total: 2, ...o })
vi.mock('../../features/admin/repository.ts', () => ({
  listCities: () => Promise.resolve([{ id: 'c1', name: 'Itaú de Minas', state: 'MG', slug: 'x', centerLat: null, centerLng: null, isActive: true }]),
  listTestData: () => Promise.resolve([]),
  createTestData: (id: string) => {
    h.created(id)
    return Promise.resolve({ runId: 'r1', city: 'Itaú de Minas - MG', password: 'Teste-ABCDEF12!', logins: [{ role: 'cliente', label: 'Cliente 1', email: 'cliente1-x@teste.example.com' }] })
  },
  removeTestData: () => Promise.resolve(),
  listAccounts: (...args: unknown[]) => {
    h.list(...args)
    return Promise.resolve([account({}), account({ id: 'a2', email: 'loja1-x@teste.example.com', fullName: 'Loja Teste', username: null, roles: ['merchant_owner'], isTest: true })])
  },
  setAccountName: () => Promise.resolve(),
  setAccountUsername: () => Promise.resolve('ana'),
  setAccountPassword: (id: string, pw: string) => {
    h.password(id, pw)
    return Promise.resolve()
  },
  setAccountBlocked: () => Promise.resolve(),
  startPasswordRecovery: () => Promise.resolve('ana@exemplo.com'),
  accountDetail: () => Promise.resolve({ id: 'a1', email: 'ana@exemplo.com', full_name: 'Ana Real', username: 'ana', phone: null, created_at: '2026-11-01T10:00:00Z',
    last_sign_in_at: null, email_confirmed: true, blocked: false, is_test: false, must_change_password: false, roles: ['customer'], permissions: [],
    memberships: [{ business_id: 'b1', business: 'Mercadinho', role: 'attendant', status: 'active' }], courier: null, orders: 2, audit: [] }),
}))
vi.mock('../../features/account/repository.ts', () => ({ sendPasswordRecoveryEmail: (e: string) => { h.recovery(e); return Promise.resolve() } }))
vi.mock('./access-context.ts', () => ({ useAdminAccess: () => h.access }))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { AdminLogins } from './AdminLogins.tsx'

afterEach(cleanup)
const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><AdminLogins /></MemoryRouter>
    </QueryClientProvider>,
  )

describe('Aba Logins', () => {
  it('lista contas reais e de teste e filtra por tipo', async () => {
    show()
    expect(await screen.findByText('Ana Real')).toBeInTheDocument()
    expect(screen.getByText('Loja Teste')).toBeInTheDocument()
    expect(screen.getByText('Teste', { selector: 'span' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Teste' }))
    await vi.waitFor(() => expect(h.list).toHaveBeenLastCalledWith('', 'teste', 30, 0))
  })

  it('suporte define nova senha e ela aparece uma vez', async () => {
    show()
    fireEvent.click((await screen.findAllByRole('button', { name: /Senha temporária/ }))[0]!)
    const input = screen.getByLabelText(/Senha temporária \(gerada/)
    fireEvent.change(input, { target: { value: 'Provisoria123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Provisoria123')).toBeInTheDocument()
    expect(h.password).toHaveBeenCalledWith('a1', 'Provisoria123')
  })

  it('envia a recuperação de senha pelo Supabase Auth e mostra os detalhes da conta', async () => {
    show()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click((await screen.findAllByRole('button', { name: /Enviar recuperação de senha/ }))[0]!)
    await vi.waitFor(() => expect(h.recovery).toHaveBeenCalledWith('ana@exemplo.com'))
    fireEvent.click(screen.getAllByRole('button', { name: /Ver detalhes/ })[0]!)
    expect(await screen.findByText('Alterações administrativas nesta conta')).toBeInTheDocument()
    expect(screen.getByText(/Mercadinho · Atendente/)).toBeInTheDocument()
  })

  it('sem permissão de suporte não mostra ações', async () => {
    h.access = { isMaster: false, mfaOk: true, permissions: ['users.view'] }
    show()
    await screen.findByText('Ana Real')
    expect(screen.queryByRole('button', { name: /Senha temporária/ })).toBeNull()
    h.access = { isMaster: true, mfaOk: true, permissions: [] }
  })

  it('dados de teste ficam nesta aba', async () => {
    show()
    const button = screen.getByRole('button', { name: /Criar dados de teste/ })
    const city = screen.getByRole('combobox', { name: 'Cidade' })
    fireEvent.focus(city)
    fireEvent.change(city, { target: { value: 'itau' } })
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Itaú de Minas - MG/ }))
    fireEvent.click(button)
    expect(await screen.findByText('Teste-ABCDEF12!')).toBeInTheDocument()
    expect(h.created).toHaveBeenCalledWith('c1')
  })
})
