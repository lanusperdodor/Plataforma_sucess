import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
vi.mock('../pages/BusinessPage.tsx', () => ({ BusinessPage: () => <h1>Detalhe do restaurante</h1> }))
vi.mock('../pages/ServicesPage.tsx', () => ({ ServicesPage: () => <h1>Serviços</h1> }))
vi.mock('../pages/NotFoundPage.tsx', () => ({ NotFoundPage: () => <h1>Não encontrada</h1> }))
vi.mock('../pages/ConectaPage.tsx', () => ({ ConectaPage: () => <h1>Conectuaí</h1> }))
vi.mock('../pages/CouriersPage.tsx', () => ({ CouriersPage: () => <h1>Entregadores parceiros</h1> }))

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
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter></QueryClientProvider>,
    )
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(currentLabels(nav)).toEqual(['Explorar'])
  })

  it('desktop: /restaurantes/x ativa Explorar na SideNav e o link do próprio item', async () => {
    setWidth(1280)
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/restaurantes/x']}>
        <AppRoutes />
      </MemoryRouter></QueryClientProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Detalhe do restaurante' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Menu lateral' })
    expect(currentLabels(nav)).toContain('Explorar')
    expect(screen.queryByRole('navigation', { name: 'Navegação principal' })).toBeNull()
  })

  it('rota desconhecida renderiza 404 sem destino ativo', async () => {
    setWidth(375)
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/nada-aqui']}>
        <AppRoutes />
      </MemoryRouter></QueryClientProvider>,
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
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/sacola/checkout?cupom=X']}>
        <Routes>
          <Route path="/entrar" element={<Login />} />
          <Route path="*" element={<AppRoutes />} />
        </Routes>
      </MemoryRouter></QueryClientProvider>,
    )
    expect(await screen.findByTestId('from')).toHaveTextContent('/sacola/checkout?cupom=X')
  })

  it('antiga /comunidade leva ao Conectuaí, que é só para quem está logado', async () => {
    setWidth(375)
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/comunidade']}>
        <AppRoutes />
      </MemoryRouter></QueryClientProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
  })

  it('a prévia visual /previa não existe mais', async () => {
    setWidth(375)
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/previa']}>
        <AppRoutes />
      </MemoryRouter></QueryClientProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Não encontrada' })).toBeInTheDocument()
  })

  it('desktop: menu lateral tem entrada clara para Entregadores', async () => {
    setWidth(1280)
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/entregadores']}>
        <AppRoutes />
      </MemoryRouter></QueryClientProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Entregadores parceiros' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Menu lateral' })
    expect(currentLabels(nav)).toContain('Seja entregador')
  })
})
