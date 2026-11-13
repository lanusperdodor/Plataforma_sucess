import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ step: vi.fn(), offers: vi.fn() }))
vi.mock('../../features/courier/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../../features/courier/repository.ts')>()),
  getMyCourier: () => Promise.resolve(null),
  listOffers: () => { h.offers(); return Promise.resolve([]) },
  ownDeliveries: (active: boolean) => Promise.resolve(active ? [{ orderId: 'o3', code: 'ABC123', status: 'ready', businessId: 'b2', businessName: '[Teste] Supermercado do Tuca',
    businessAddress: 'Avenida de Teste, 200', businessPhone: '(35) 99999-0002', customerName: 'Cliente 1', customerPhone: '(35) 99999-0001', address: 'Rua A, 1, Centro',
    reference: null, payment: 'cash', totalCents: 3490, changeForCents: null, createdAt: '2026-11-12T12:00:00Z', updatedAt: '2026-11-12T12:10:00Z' }] : []),
  ownDeliveryStatus: (id: string, s: string) => { h.step(id, s); return Promise.resolve() },
}))
vi.mock('../../features/auth/AuthProvider.tsx', () => ({ useAuth: () => ({ session: { user: { id: 'p' } }, authz: { userId: 'p', roles: ['customer'], memberships: [{ businessId: 'b2', role: 'courier_own' }] } }) }))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { CourierArea } from './CourierArea.tsx'

afterEach(cleanup)

describe('Entregador 2 — Próprio do supermercado', () => {
  it('vê só as entregas atribuídas, sem ofertas da rede, e registra saída', async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><CourierArea /></MemoryRouter></QueryClientProvider>)
    expect(await screen.findByText('#ABC123 · [Teste] Supermercado do Tuca')).toBeInTheDocument()
    expect(screen.getByText(/só as entregas que o estabelecimento atribuir a você/)).toBeInTheDocument()
    expect(screen.queryByText('Disponibilidade')).not.toBeInTheDocument()
    expect(h.offers).not.toHaveBeenCalled()
    // mesmo painel do entregador independente: cabeçalho e abas (sem carteira Tucaí, que é só do independente)
    expect(screen.getByRole('heading', { name: 'Área do entregador' })).toBeInTheDocument()
    const tabs = screen.getByRole('navigation', { name: 'Seções do entregador' })
    expect(tabs).toHaveTextContent('Entregas')
    expect(tabs).toHaveTextContent('Histórico')
    expect(tabs).not.toHaveTextContent('Saques')
    fireEvent.click(screen.getByRole('button', { name: 'Saí para entrega' }))
    await vi.waitFor(() => expect(h.step).toHaveBeenCalledWith('o3', 'out_for_delivery'))
  })
})
