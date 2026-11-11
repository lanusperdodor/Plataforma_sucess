import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ cancel: vi.fn(), redispatch: vi.fn(), list: vi.fn(), access: { isMaster: true, mfaOk: true, permissions: [] as string[] } }))
const row = {
  id: 'o1', code: 'ABC123', createdAt: '2026-11-11T12:00:00Z', status: 'ready', fulfillment: 'delivery_partner', payment: 'cash',
  businessName: '[Teste] Lanchonete do Tuca', city: 'Itaú de Minas - MG', customerName: 'Cliente Teste Um', courierName: null,
  totalCents: 6200, commissionCents: 116, platformFeeCents: 100, deliveryStatus: 'offered', attention: 'Sem entregador após 3 rodadas de oferta', isTest: true, total: 1,
}
const detail = {
  id: 'o1', code: 'ABC123', status: 'ready', fulfillment: 'delivery_partner', payment_method: 'cash', created_at: '2026-11-11T12:00:00Z', is_test: true,
  notes: null, rejection_reason: null, prep_minutes: 20, estimated_ready_at: null, attention: 'Sem entregador após 3 rodadas de oferta',
  customer: { name: 'Cliente Teste Um', phone: '(35) 99999-0000', address: 'Rua das Flores, 100, Centro' },
  business: { id: 'b1', name: '[Teste] Lanchonete do Tuca', phone: null, address: null, city: 'Itaú de Minas - MG' },
  values: { subtotal_cents: 5800, delivery_fee_cents: 400, total_cents: 6200, commission_cents: 116, merchant_delivery_cents: 200, courier_pay_cents: 500, platform_fee_cents: 100, pricing_version: 1 },
  items: [{ name: 'X-Burger', quantity: 1, unit_price_cents: 3000, line_total_cents: 3000, options: [{ group: 'Ponto', option: 'Ao ponto' }], notes: null }],
  events: [
    { status: 'placed', note: null, at: '2026-11-11T12:00:00Z', actor: 'cliente' },
    { status: 'accepted', note: 'Preparo estimado em 20 min', at: '2026-11-11T12:01:00Z', actor: 'estabelecimento' },
  ],
  delivery: { status: 'offered', offer_round: 3, offer_expires_at: null, offered_at: '2026-11-11T12:20:00Z', accepted_at: null, picked_up_at: null,
    delivered_at: null, attention_reason: 'Sem entregador após 3 rodadas de oferta', failed_code_attempts: 0, declines: 2, courier: null },
}
vi.mock('../../features/admin/repository.ts', () => ({
  listAdminOrders: (...a: unknown[]) => { h.list(...a); return Promise.resolve([row]) },
  getAdminOrder: () => Promise.resolve(detail),
  cancelOrderAsPlatform: (id: string, reason: string) => { h.cancel(id, reason); return Promise.resolve() },
  redispatchOrder: (id: string) => { h.redispatch(id); return Promise.resolve() },
}))
vi.mock('./access-context.ts', () => ({ useAdminAccess: () => h.access }))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { AdminOrders } from './AdminOrders.tsx'

afterEach(cleanup)
const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><AdminOrders /></MemoryRouter>
    </QueryClientProvider>,
  )

describe('Pedidos do Master', () => {
  it('lista com alerta e marca de teste, e filtra por situação', async () => {
    show()
    expect(await screen.findByText('#ABC123')).toBeInTheDocument()
    expect(screen.getByText('Sem entregador após 3 rodadas de oferta')).toBeInTheDocument()
    expect(screen.getByText('Teste', { selector: 'span' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Com alerta' }))
    await vi.waitFor(() => expect(h.list).toHaveBeenLastCalledWith('atencao', '', true, 30, 0))
  })

  it('detalhe mostra valores, histórico com autores e trata a ocorrência', async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: /#ABC123/ }))
    expect(await screen.findByText('Comissão Tucaí')).toBeInTheDocument()
    expect(screen.getByText(/Rodada 3 · 2 recusa/)).toBeInTheDocument()
    expect(screen.getByText(/Preparo estimado em 20 min/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Redistribuir entrega/ }))
    await vi.waitFor(() => expect(h.redispatch).toHaveBeenCalledWith('o1'))
    vi.spyOn(window, 'prompt').mockReturnValue('Restaurante sem entregador')
    fireEvent.click(screen.getByRole('button', { name: /Cancelar pedido/ }))
    await vi.waitFor(() => expect(h.cancel).toHaveBeenCalledWith('o1', 'Restaurante sem entregador'))
  })

  it('sem orders.manage não mostra ações', async () => {
    h.access = { isMaster: false, mfaOk: true, permissions: ['orders.view'] }
    show()
    fireEvent.click(await screen.findByRole('button', { name: /#ABC123/ }))
    await screen.findByText('Comissão Tucaí')
    expect(screen.queryByRole('button', { name: /Cancelar pedido/ })).toBeNull()
    h.access = { isMaster: true, mfaOk: true, permissions: [] }
  })
})
