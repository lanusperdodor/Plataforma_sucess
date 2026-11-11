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

afterEach(() => { cleanup(); h.session = null; h.authz = null })
const show = () => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><AccountMenu /></MemoryRouter></QueryClientProvider>)

describe('Menu de conta', () => {
  it('mostra o nome real, o perfil ativo e os atalhos do perfil', async () => {
    h.session = { user: { id: 'u1', email: 'carla@x.com' } }
    h.authz = { userId: 'u1', roles: ['customer'], memberships: [{ businessId: 'b1', role: 'attendant' }] }
    show()
    expect(await screen.findByText('Carla')).toBeInTheDocument()
    expect(screen.getByText('Mercadinho Teste — Operador')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Conta de Carla/ }))
    expect(screen.getByRole('menuitem', { name: /Painel do estabelecimento/ })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Tema' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /Sair/ }))
    expect(h.signOut).toHaveBeenCalled()
  })
  it('sem sessão: Entrar / Criar conta e botão de tema', () => {
    show()
    expect(screen.getByRole('link', { name: 'Entrar' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Criar conta' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /modo (escuro|claro)/ })).toBeInTheDocument()
  })
})
