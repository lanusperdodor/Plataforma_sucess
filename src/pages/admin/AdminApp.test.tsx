import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminAccess } from '../../features/admin/repository.ts'

const h = vi.hoisted(() => ({
  auth: { loading: false, session: { user: { id: 'u1', email: 'x@y.z' } } as unknown, signOut: () => Promise.resolve({ error: false }) },
  access: null as unknown as AdminAccess,
}))
vi.mock('../../features/auth/AuthProvider.tsx', () => ({ useAuth: () => h.auth }))
vi.mock('../../features/admin/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../../features/admin/repository.ts')>()),
  getMyAccess: () => Promise.resolve(h.access),
  getDashboard: () => new Promise(() => {}),
}))
vi.mock('./AdminSecurity.tsx', () => ({ AdminSecurity: () => <h1>Segurança (MFA)</h1> }))
vi.mock('./AdminCities.tsx', () => ({ AdminCities: () => <h1>Gestão de cidades</h1> }))

import { AdminApp } from './AdminApp.tsx'

const base: AdminAccess = { isMaster: false, isOperator: true, mfaRequired: false, aal: 'aal1', mfaOk: true, permissions: [] }

function view(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/entrar" element={<p>Login único</p>} />
          <Route path="/admin/*" element={<AdminApp />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(cleanup)

describe('Painel Master — guarda de acesso (UX; o banco autoriza de novo)', () => {
  it('sem sessão vai para o login único (/entrar)', async () => {
    h.auth = { ...h.auth, session: null }
    view('/admin')
    expect(await screen.findByText('Login único')).toBeInTheDocument()
    h.auth = { ...h.auth, session: { user: { id: 'u1', email: 'x@y.z' } } }
  })

  it('cliente comum vê acesso restrito', async () => {
    h.access = { ...base, isOperator: false }
    view('/admin')
    expect(await screen.findByText('Acesso restrito')).toBeInTheDocument()
  })

  it('operador sem a permissão não abre a área e não vê o item no menu', async () => {
    h.access = { ...base, permissions: ['businesses.review'] }
    view('/admin/cidades')
    expect(await screen.findByText('Sem permissão para esta área')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Cidades' })).toBeNull()
    expect(screen.getAllByRole('link', { name: 'Estabelecimentos' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: 'Equipe' })).toBeNull()
  })

  it('operador com a permissão abre a área', async () => {
    h.access = { ...base, permissions: ['cities.manage'] }
    view('/admin/cidades')
    expect(await screen.findByRole('heading', { name: 'Gestão de cidades' })).toBeInTheDocument()
  })

  it('MFA exigido e sessão aal1: qualquer área leva à Segurança', async () => {
    h.access = { ...base, isMaster: true, isOperator: false, mfaRequired: true, mfaOk: false, permissions: [] }
    view('/admin/cidades')
    expect(await screen.findByRole('heading', { name: 'Segurança (MFA)' })).toBeInTheDocument()
  })
})
