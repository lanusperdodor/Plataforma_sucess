import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { lazy } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RouteBoundary } from './RouteBoundary.tsx'
import { RequireAuth } from '../features/auth/RequireAuth.tsx'

vi.mock('../features/auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ loading: false, session: null, authz: null, authzError: false, recovering: false }),
}))

afterEach(cleanup)

describe('RouteBoundary', () => {
  it('mostra "Recarregar" quando o chunk lazy rejeita', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const Broken = lazy(() => Promise.reject(new Error('Failed to fetch dynamically imported module: x.js')))
    render(
      <MemoryRouter>
        <RouteBoundary>
          <Broken />
        </RouteBoundary>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Não foi possível carregar esta tela')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recarregar' })).toBeInTheDocument()
  })
})

describe('rota privada', () => {
  it('sem sessão redireciona para /entrar', () => {
    function Where() {
      return <p>em {useLocation().pathname}</p>
    }
    render(
      <MemoryRouter initialEntries={['/pedidos']}>
        <Routes>
          <Route path="/entrar" element={<Where />} />
          <Route path="/pedidos" element={<RequireAuth><p>privado</p></RequireAuth>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('em /entrar')).toBeInTheDocument()
  })
})
