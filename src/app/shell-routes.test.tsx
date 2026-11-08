import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../features/auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ loading: false, session: null, authz: null, authzError: false, recovering: false }),
}))
vi.mock('../components/shell/useShellData.ts', async (orig) => ({
  ...(await orig<typeof import('../components/shell/useShellData.ts')>()),
  useCartSummary: () => ({ count: 0, totalCents: 0 }),
  useUnreadCount: () => 0,
}))
vi.mock('../components/shell/LocationPicker.tsx', () => ({ LocationPicker: () => <button>Cidade</button> }))
vi.mock('../pages/RestaurantPage.tsx', () => ({ RestaurantPage: () => <h1>Detalhe do restaurante</h1> }))
vi.mock('../pages/ServicesPage.tsx', () => ({ ServicesPage: () => <h1>Serviços</h1> }))
vi.mock('../pages/NotFoundPage.tsx', () => ({ NotFoundPage: () => <h1>Não encontrada</h1> }))

import { AppRoutes } from './routes.tsx'

function setWidth(width: number) {
  window.matchMedia = ((query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0)
    return { matches: width >= min, media: query, addEventListener: () => {}, removeEventListener: () => {} }
  }) as unknown as typeof window.matchMedia
}

const original = window.matchMedia
window.scrollTo = (() => {}) as typeof window.scrollTo
afterEach(() => {
  cleanup()
  window.matchMedia = original
})

function currentLabels(nav: HTMLElement) {
  return Array.from(nav.querySelectorAll('[aria-current="page"]')).map((el) => el.textContent?.trim())
}

describe('AppShell + rotas reais', () => {
  it.each([
    ['/restaurantes/x', 'Detalhe do restaurante'],
    ['/servicos', 'Serviços'],
  ])('mobile: %s ativa só Explorar na BottomNav', async (path, heading) => {
    setWidth(375)
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(currentLabels(nav)).toEqual(['Explorar'])
  })

  it('desktop: /restaurantes/x ativa Explorar na SideNav e o link do próprio item', async () => {
    setWidth(1280)
    render(
      <MemoryRouter initialEntries={['/restaurantes/x']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Detalhe do restaurante' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Menu lateral' })
    expect(currentLabels(nav)).toContain('Explorar')
    expect(screen.queryByRole('navigation', { name: 'Navegação principal' })).toBeNull()
  })

  it('rota desconhecida renderiza 404 sem destino ativo', async () => {
    setWidth(375)
    render(
      <MemoryRouter initialEntries={['/nada-aqui']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Não encontrada' })).toBeInTheDocument()
    expect(currentLabels(screen.getByRole('navigation', { name: 'Navegação principal' }))).toEqual([])
  })

  it('rota privada preserva pathname + search em state.from ao redirecionar', async () => {
    setWidth(375)
    function Login() {
      const l = useLocation()
      return <p data-testid="from">{String((l.state as { from?: string } | null)?.from)}</p>
    }
    render(
      <MemoryRouter initialEntries={['/sacola/checkout?cupom=X']}>
        <Routes>
          <Route path="/entrar" element={<Login />} />
          <Route path="*" element={<AppRoutes />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('from')).toHaveTextContent('/sacola/checkout?cupom=X')
  })
})
