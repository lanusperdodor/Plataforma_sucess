import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: null as unknown,
  count: 0,
  unread: 0,
  compact: false,
}))

vi.mock('../../features/auth/AuthProvider.tsx', () => ({ useAuth: () => ({ session: mocks.session }) }))
vi.mock('./useCompactHeader.ts', () => ({ useCompactHeader: () => mocks.compact }))
vi.mock('./useShellData.ts', async (orig) => ({
  ...(await orig<typeof import('./useShellData.ts')>()),
  useCartSummary: () => ({ count: mocks.count, totalCents: 0 }),
  useUnreadCount: () => mocks.unread,
}))

import { TopBar } from './TopBar.tsx'
import { formatBadge } from './useShellData.ts'

const view = (layout: 'mobile' | 'desktop' = 'mobile') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>
      <TopBar layout={layout} />
    </MemoryRouter></QueryClientProvider>,
  )

afterEach(() => {
  cleanup()
  Object.assign(mocks, { session: null, count: 0, unread: 0, compact: false })
})

describe('formatBadge', () => {
  it('oculta 0, mostra 1–9 e "9+" acima', () => {
    expect([0, 1, 9, 10, 120].map(formatBadge)).toEqual(['', '1', '9', '9+', '9+'])
  })
})

describe('TopBar', () => {
  it('sem sessão mostra Entrar / Criar conta; com sessão mostra quem está conectado', () => {
    view('desktop')
    expect(screen.getByText('Entrar')).toBeInTheDocument()
    expect(screen.getByText('Criar conta')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /modo (escuro|claro)/ })).toBeInTheDocument()
    cleanup()
    mocks.session = { user: { id: 'u1', email: 'joao@exemplo.com' } }
    view('desktop')
    expect(screen.queryByText('Entrar')).toBeNull()
    expect(screen.getByRole('button', { name: /Conta de joao/ })).toBeInTheDocument()
    expect(screen.getByText('joao')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /modo (escuro|claro)/ })).toBeInTheDocument()
  })

  it('expõe contadores nos aria-labels', () => {
    mocks.count = 2
    mocks.unread = 3
    view()
    expect(screen.getByLabelText('Sacola, 2 itens')).toBeInTheDocument()
    expect(screen.getByLabelText('Notificações, 3 não lidas')).toBeInTheDocument()
  })

  it('sem contagem, rótulos simples e localização padrão', () => {
    view()
    expect(screen.getByLabelText('Sacola')).toBeInTheDocument()
    expect(screen.getByText('Itaú de Minas, MG')).toBeInTheDocument()
  })

  it('reflete data-compact e mantém busca e sacola visíveis no compacto', () => {
    mocks.compact = true
    mocks.count = 1
    view()
    expect(screen.getByRole('banner')).toHaveAttribute('data-compact', 'true')
    expect(screen.getByLabelText('Buscar')).toBeInTheDocument()
    expect(screen.getAllByLabelText('Sacola, 1 item').length).toBeGreaterThan(0)
  })
})

describe('botão de tema', () => {
  it('aparece no celular e alterna claro/escuro', () => {
    view('mobile')
    const btn = screen.getByRole('button', { name: /modo (escuro|claro)/ })
    const before = document.documentElement.dataset.theme
    btn.click()
    expect(document.documentElement.dataset.theme).not.toBe(before)
    localStorage.removeItem('tucai:theme')
  })
})
