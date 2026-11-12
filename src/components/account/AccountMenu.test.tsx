import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ signOut: vi.fn(() => Promise.resolve({ error: false })), authz: null as unknown, session: null as unknown }))
vi.mock('../../features/auth/AuthProvider.tsx', () => ({ useAuth: () => ({ session: h.session, authz: h.authz, signOut: h.signOut }) }))
vi.mock('../../features/account/repository.ts', () => ({
  getAccountIdentity: () => Promise.resolve({ fullName: 'Carla Souza', username: null, businesses: { b1: 'Mercadinho Teste' } }),
}))

import { AccountMenu } from './AccountMenu.tsx'

afterEach(() => { cleanup(); h.session = null; h.authz = null; localStorage.removeItem('tucai:perfil') })
const show = () => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><AccountMenu /></MemoryRouter></QueryClientProvider>)

describe('Menu de conta', () => {
  it('mostra o nome real, o perfil ativo e os atalhos do perfil', async () => {
    h.session = { user: { id: 'u1', email: 'carla@x.com' } }
    h.authz = { userId: 'u1', roles: ['customer'], memberships: [{ businessId: 'b1', role: 'attendant' }] }
    show()
    expect(await screen.findByText('Carla')).toBeInTheDocument()
    expect(screen.getByText('Mercadinho Teste — Operador')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Conta de Carla/ }))
    // lojista/equipe da loja só tem o perfil empresarial: sem "Cliente" e sem "Meus pedidos"
    expect(screen.queryByRole('menuitemradio', { name: /Cliente/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /Meus pedidos/ })).toBeNull()
    expect(screen.getByRole('radiogroup', { name: 'Tema' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /Sair/ }))
    expect(h.signOut).toHaveBeenCalled()
  })
  it('quem é cliente e entregador escolhe o perfil ativo', async () => {
    h.session = { user: { id: 'k', email: 'carlos@x.com' } }
    h.authz = { userId: 'k', roles: ['customer', 'courier_partner'], memberships: [] }
    show()
    fireEvent.click(await screen.findByRole('button', { name: /Conta de/ }))
    expect(screen.getByRole('menuitemradio', { name: /Cliente \(minhas compras\)/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitem', { name: /Meus pedidos/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Entregador/ }))
    expect(localStorage.getItem('tucai:perfil')).toBe('entregador')
  })
  it('Master não tem perfil de cliente: sem "Meus pedidos" no painel nem no site', async () => {
    h.session = { user: { id: 'm', email: 'admin@tucai.example.com' } }
    h.authz = { userId: 'm', roles: ['customer', 'platform_master'], memberships: [] }
    for (const context of ['admin', 'site'] as const) {
      render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><AccountMenu context={context} /></MemoryRouter></QueryClientProvider>)
      fireEvent.click(await screen.findByRole('button', { name: /Conta de/ }))
      expect(screen.queryByRole('menuitem', { name: /Meus pedidos/ })).toBeNull()
      expect(screen.queryByRole('menuitemradio', { name: /Cliente/ })).toBeNull()
      cleanup()
    }
  })
  it('sem sessão: Entrar / Criar conta', () => {
    show()
    expect(screen.getByRole('link', { name: 'Entrar' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Criar conta' })).toBeInTheDocument()
  })
})
