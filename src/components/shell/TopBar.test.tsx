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
    <MemoryRouter>
      <TopBar layout={layout} />
    </MemoryRouter>,
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
  it('mostra "Entrar" sem sessão e perfil com sessão', () => {
    view()
    expect(screen.getByText('Entrar')).toBeInTheDocument()
    cleanup()
    mocks.session = { user: { id: 'u1' } }
    view('desktop')
    expect(screen.queryByText('Entrar')).toBeNull()
    expect(screen.getByLabelText('Perfil')).toBeInTheDocument()
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
