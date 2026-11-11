import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ accept: vi.fn(), update: vi.fn(), status: 'placed' as string }))
vi.mock('../../features/orders/repository.ts', async (orig) => {
  const real = await orig<typeof import('../../features/orders/repository.ts')>()
  return {
    ...real,
    listBusinessOrders: () => Promise.resolve([{
      id: 'o1', code: 'ABC123', customerId: 'c', businessId: 'b1', status: h.status, fulfillment: 'delivery_partner', payment: 'cash',
      changeForCents: null, customerName: 'Cliente Teste Um', customerPhone: '35999990000', address: 'Rua A, 1', reference: null, notes: null,
      subtotalCents: 5800, deliveryFeeCents: 400, discountCents: 0, totalCents: 6200, commissionCents: 116, merchantDeliveryCents: 300,
      rejectionReason: null, createdAt: '2026-11-11T12:00:00Z', updatedAt: '2026-11-11T12:00:00Z',
      prepMinutes: h.status === 'placed' ? null : 20, estimatedReadyAt: h.status === 'placed' ? null : '2026-11-11T12:20:00Z', isTest: true,
    }]),
    listOrderItems: () => Promise.resolve([]),
    listBusinessDeliveries: () => Promise.resolve([]),
    dispatchTick: () => Promise.resolve(0),
    acceptOrder: (id: string, m: number) => { h.accept(id, m); return Promise.resolve('accepted') },
    updateOrderStatus: (id: string, s: string) => { h.update(id, s); return Promise.resolve(s) },
  }
})
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { OrdersTab } from './OperationsTabs.tsx'

afterEach(cleanup)
const show = (kitchen: boolean) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><OrdersTab businessId="b1" canUpdate kitchen={kitchen} /></MemoryRouter>
    </QueryClientProvider>,
  )

describe('Pedidos do estabelecimento', () => {
  it('atendimento aceita informando o tempo de preparo', async () => {
    h.status = 'placed'
    show(false)
    fireEvent.change(await screen.findByLabelText('Preparo'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar' }))
    await vi.waitFor(() => expect(h.accept).toHaveBeenCalledWith('o1', 30))
  })

  it('cozinha não vê aceitar/recusar; só o preparo, com a previsão', async () => {
    h.status = 'placed'
    show(true)
    await screen.findByText(/#ABC123/)
    expect(screen.queryByRole('button', { name: 'Aceitar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Recusar' })).toBeNull()
    cleanup()
    h.status = 'accepted'
    show(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar preparo' }))
    await vi.waitFor(() => expect(h.update).toHaveBeenCalledWith('o1', 'preparing'))
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull()
    expect(screen.getByText(/Previsão de pronto/)).toBeInTheDocument()
  })
})
