import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('../features/auth/AuthProvider.tsx', () => ({ useAuth: () => auth.value }))

import { LoginPage, SignUpPage } from './AuthPages.tsx'

function Where() { return <p data-testid="where">{useLocation().pathname}</p> }
const view = (path = '/entrar') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/entrar" element={<LoginPage />} />
        <Route path="/cadastro" element={<SignUpPage />} />
        <Route path="/admin/entrar" element={<Navigate to="/entrar" replace state={{ from: '/admin' }} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
const logged = (roles: string[], memberships: { businessId: string; role: string }[] = []) => {
  auth.value = { loading: false, authzError: false, session: { user: { id: 'u' } }, authz: { userId: 'u', roles, memberships } }
}
afterEach(cleanup)

describe('login único da Tucaí', () => {
  it('uma só tela: entrar, criar conta e "já sou cadastrado"', () => {
    auth.value = { loading: false, session: null, authz: null }
    view()
    expect(screen.getByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
    expect(screen.getByText(/Um só acesso para clientes, empresários, funcionários, entregadores e equipe Tucaí/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Criar conta' })).toHaveAttribute('href', '/cadastro')
    cleanup()
    view('/cadastro')
    expect(screen.getByText(/Já sou cadastrado/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/entrar')
  })
  it('reconhece a credencial e abre o painel do perfil', () => {
    const cases: [string[], { businessId: string; role: string }[], string][] = [
      [['customer', 'platform_master'], [], '/admin'],
      [['customer'], [{ businessId: 'b1', role: 'owner' }], '/painel/b1'],
      [['customer'], [{ businessId: 'b1', role: 'attendant' }], '/painel/b1/pedidos'],
      [['customer', 'courier_partner'], [], '/entregador'],
      [['customer'], [{ businessId: 'b2', role: 'courier_own' }], '/entregador'],
      [['customer'], [], '/'],
    ]
    for (const [roles, ms, dest] of cases) {
      logged(roles, ms)
      view()
      expect(screen.getByTestId('where')).toHaveTextContent(dest)
      cleanup()
    }
  })
  it('o endereço antigo da administração cai no mesmo login', () => {
    auth.value = { loading: false, session: null, authz: null }
    view('/admin/entrar')
    expect(screen.getByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
  })
})

import { oauthReturnError } from '../features/auth/signIn.ts'
describe('volta do login com Google', () => {
  it('traduz os erros devolvidos pelo Google/Supabase sem detalhes técnicos', () => {
    expect(oauthReturnError('?error=access_denied&error_description=The+user+denied', '')).toMatch(/cancelado/)
    expect(oauthReturnError('', '#error=invalid_request&error_code=validation_failed&error_description=Unsupported+provider%3A+provider+is+not+enabled')).toMatch(/ainda não foi ativado/)
    expect(oauthReturnError('?error=server_error&error_description=redirect+url+not+allowed', '')).toMatch(/não está autorizado para este endereço/)
    expect(oauthReturnError('?code=abc', '#access_token=x')).toBeNull()
  })
  it('a tela de login mostra o motivo quando volta com erro', () => {
    auth.value = { loading: false, session: null, authz: null }
    view('/entrar?error=access_denied&error_description=cancelled')
    expect(screen.getByRole('alert')).toHaveTextContent('Login com Google cancelado')
  })
})
