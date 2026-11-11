import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('../features/auth/AuthProvider.tsx', () => ({ useAuth: () => auth.value }))
vi.mock('../features/auth/signIn.ts', () => ({ isSupabaseConfigured: true, signInWithPassword: vi.fn() }))

import { AdminLoginPage } from './AdminLoginPage.tsx'

const base = { loading: false, authzError: false, signOut: vi.fn() }
const view = () =>
  render(
    <MemoryRouter initialEntries={['/admin/entrar']}>
      <Routes>
        <Route path="/admin/entrar" element={<AdminLoginPage />} />
        <Route path="/admin" element={<p>Painel Master</p>} />
      </Routes>
    </MemoryRouter>,
  )
afterEach(cleanup)

describe('AdminLoginPage', () => {
  it('sem sessão mostra o formulário restrito', () => {
    auth.value = { ...base, session: null, authz: null }
    view()
    expect(screen.getByRole('heading', { name: 'Entrar na administração' })).toBeInTheDocument()
    expect(screen.getByLabelText('Usuário ou e-mail')).toBeInTheDocument()
  })
  it('cliente comum logado NÃO recebe acesso administrativo', () => {
    auth.value = { ...base, session: { user: { id: 'a' } }, authz: { userId: 'a', roles: ['customer'], memberships: [] } }
    view()
    expect(screen.getByRole('alert')).toHaveTextContent('não tem permissão de administração')
  })
  it('papel vindo do banco (platform_master) segue para o Painel Master', () => {
    auth.value = { ...base, session: { user: { id: 'm' } }, authz: { userId: 'm', roles: ['customer', 'platform_master'], memberships: [] } }
    view()
    expect(screen.getByText('Painel Master')).toBeInTheDocument()
  })
})