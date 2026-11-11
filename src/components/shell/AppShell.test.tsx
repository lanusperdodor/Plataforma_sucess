import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ count: 0 }))

vi.mock('../../features/auth/AuthProvider.tsx', () => ({ useAuth: () => ({ session: null }) }))
vi.mock('./useShellData.ts', async (orig) => ({
  ...(await orig<typeof import('./useShellData.ts')>()),
  useCartSummary: () => ({ count: mocks.count, totalCents: 1000 }),
  useUnreadCount: () => 0,
}))

vi.mock('./LocationPicker.tsx', () => ({ LocationPicker: () => <button>Cidade</button> }))

import { AppShell } from './AppShell.tsx'
import { useAnnounce } from './announceContext.ts'

function setWidth(width: number) {
  window.matchMedia = ((query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0)
    return {
      matches: width >= min,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
  }) as unknown as typeof window.matchMedia
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function Announcer() {
  const announce = useAnnounce()
  return <button onClick={() => announce('Item adicionado')}>anunciar</button>
}

const view = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/']}>
      <AppShell>
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
        <Announcer />
      </AppShell>
    </MemoryRouter></QueryClientProvider>,
  )

const original = window.matchMedia
window.scrollTo = (() => {}) as typeof window.scrollTo
afterEach(() => {
  cleanup()
  window.matchMedia = original
  mocks.count = 0
  vi.useRealTimers()
})

describe('AppShell', () => {
  it('mobile: header, BottomNav única, main e skip link', () => {
    setWidth(375)
    view()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument()
    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('id', 'conteudo')
    expect(main).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('link', { name: 'Pular para o conteúdo' })).toHaveAttribute('href', '#conteudo')
  })

  it('tablet: trilho lateral e sem BottomNav', () => {
    setWidth(800)
    view()
    expect(screen.queryByRole('navigation', { name: 'Navegação principal' })).toBeNull()
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Expandir menu' })).toBeInTheDocument()
  })

  it('desktop: SideNav expandida e conteúdo limitado a --content-max', () => {
    setWidth(1280)
    view()
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Expandir menu' })).toBeNull()
    expect(screen.getByTestId('where').parentElement?.className).toContain('max-w-[var(--content-max)]')
  })

  it('FAB da sacola só no mobile e navega para /sacola', () => {
    mocks.count = 2
    setWidth(375)
    view()
    fireEvent.click(screen.getByRole('button', { name: /Ver sacola/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/sacola')
    cleanup()
    setWidth(1280)
    view()
    expect(screen.queryByRole('button', { name: /Ver sacola/ })).toBeNull()
  })

  it('região aria-live recebe anúncios', () => {
    vi.useFakeTimers()
    setWidth(375)
    view()
    fireEvent.click(screen.getByText('anunciar'))
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(screen.getByTestId('announcer')).toHaveTextContent('Item adicionado')
    expect(screen.getByTestId('announcer')).toHaveAttribute('aria-live', 'polite')
  })
})
