import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ decline: vi.fn(), accept: vi.fn() }))
vi.mock('../../features/courier/repository.ts', async (orig) => {
  const real = await orig<typeof import('../../features/courier/repository.ts')>()
  return {
    ...real,
    getMyCourier: () => Promise.resolve({ userId: 'k1', fullName: 'Entregador Teste', vehicle: 'moto', plate: 'TST1A23', status: 'approved', isOnline: true }),
    myDeliveries: () => Promise.resolve([]),
    getEarnings: () => Promise.resolve({ todayCents: 0, weekCents: 0, totalCents: 500, deliveries: 1 }),
    listOffers: () => Promise.resolve([{ orderId: 'o1', businessName: '[Teste] Lanchonete do Tuca', businessAddress: 'Rua de Teste, 100', payCents: 500,
      offeredAt: '2026-11-11T12:00:00Z', neighborhood: 'Centro', itemsCount: 2, expiresAt: new Date(Date.now() + 120_000).toISOString(), round: 2 }]),
    declineOffer: (id: string) => { h.decline(id); return Promise.resolve() },
    acceptDelivery: (id: string) => { h.accept(id); return Promise.resolve() },
  }
})
vi.mock('../../features/auth/AuthProvider.tsx', () => ({ useAuth: () => ({ session: { user: { id: 'k1' } } }) }))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { CourierArea } from './CourierArea.tsx'

afterEach(cleanup)

describe('Área do entregador', () => {
  it('mostra prazo e rodada da oferta, recusa e aceita', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><CourierArea /></MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/Responda em [12]:\d\d · 2ª rodada/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Compartilhar minha localização/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }))
    await vi.waitFor(() => expect(h.decline).toHaveBeenCalledWith('o1'))
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar' }))
    await vi.waitFor(() => expect(h.accept).toHaveBeenCalledWith('o1'))
  })
})
