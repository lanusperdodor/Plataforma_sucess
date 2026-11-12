import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ open: vi.fn(), add: vi.fn(), close: vi.fn(), request: vi.fn(), cashOpen: true }))
const card = (o: Record<string, unknown>) => ({
  tableId: null, tableName: null, area: null, capacity: 4, tabId: null, tabNumber: null, tabLabel: null, people: null, situation: 'livre',
  openedAt: null, lastActivityAt: null, openedBy: null, totalCents: 0, itemsCount: 0, pendingKitchen: 0, readyItems: 0, ...o,
})
vi.mock('../../features/gestao/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../../features/gestao/repository.ts')>()),
  getBoard: () => Promise.resolve([
    card({ tableId: 't1', tableName: 'Mesa 01' }),
    card({ tableId: 't2', tableName: 'Mesa 02', tabId: 'tab2', tabNumber: 21, situation: 'ocupada', openedAt: new Date().toISOString(), totalCents: 4400, itemsCount: 2 }),
    card({ tableId: 't3', tableName: 'Mesa 03', tabId: 'tab3', tabNumber: 22, situation: 'em_preparo', totalCents: 2200, itemsCount: 1 }),
    card({ tableId: 't4', tableName: 'Mesa 04', tabId: 'tab4', tabNumber: 23, situation: 'aguardando_pagamento', totalCents: 3000, itemsCount: 1 }),
  ]),
  openTab: (...a: unknown[]) => { h.open(...a); return Promise.resolve('tabNew') },
  listTabItems: () => Promise.resolve([{ id: 'i1', name: 'Cheeseburger', quantity: 2, unitCents: 2200, notes: 'sem cebola', status: 'novo', createdAt: new Date().toISOString() }]),
  addTabItems: (...a: unknown[]) => { h.add(...a); return Promise.resolve(1) },
  requestClose: (...a: unknown[]) => { h.request(...a); return Promise.resolve() },
  closeTab: (...a: unknown[]) => { h.close(...a); return Promise.resolve({ status: 'fechada' }) },
  getCashStatus: () => Promise.resolve(h.cashOpen ? { open: true, session_id: 's1', opened_at: new Date().toISOString(), opened_by: 'Ana' } : { open: false }),
}))
vi.mock('../../features/merchant/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../../features/merchant/repository.ts')>()),
  listProducts: () => Promise.resolve([{ id: 'p1', categoryId: 'c', name: 'Cheeseburger', description: null, priceCents: 2200, imageUrl: null, isAvailable: true, sortOrder: 0 }]),
}))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { GestaoContext, type GestaoCtx } from './context.ts'
import { TablesTab } from './TablesTab.tsx'

afterEach(cleanup)
const ctx = (perms: string[]): GestaoCtx => ({
  business: { id: 'b1', name: 'Restaurante Teste', businessType: 'restaurante' } as GestaoCtx['business'],
  niche: 'restaurante', plan: { code: 'presencial_delivery', name: 'Premium', premium: true, source: 'homologacao', periodEnd: null }, premium: true,
  can: (p) => perms.includes(p),
})
const show = (perms = ['tabs.manage', 'cash.manage', 'settings.manage']) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><GestaoContext.Provider value={ctx(perms)}><TablesTab /></GestaoContext.Provider></MemoryRouter>
    </QueryClientProvider>,
  )

describe('Comandas e mesas', () => {
  it('mostra o quadro com situação e texto (cor nunca sozinha)', async () => {
    show()
    const mesas = await screen.findByRole('list', { name: 'Mesas' })
    expect(within(mesas).getByText('Disponível para atendimento')).toBeInTheDocument()
    expect(within(mesas).getByText('Comanda aberta')).toBeInTheDocument()
    expect(within(mesas).getByText('Cozinha trabalhando')).toBeInTheDocument()
    expect(within(mesas).getByText('Solicitou fechamento')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Configurar mesas/ })).toBeInTheDocument()
  })
  it('abre a mesa livre', async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: /Mesa 01/ }))
    fireEvent.change(screen.getByLabelText('Pessoas (opcional)'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir mesa' }))
    await vi.waitFor(() => expect(h.open).toHaveBeenCalledWith('b1', 't1', '', 3))
  })
  it('lança itens com observação, com identificador de operação', async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: /Mesa 02/ }))
    const dialog = await screen.findByRole('dialog', { name: /Mesa 02 — Comanda #021/ })
    expect(await within(dialog).findByText('Obs.: sem cebola')).toBeInTheDocument()
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Adicionar Cheeseburger' }))
    fireEvent.change(within(dialog).getByLabelText('Observação para Cheeseburger'), { target: { value: 'ao ponto' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Enviar para a cozinha/ }))
    await vi.waitFor(() => expect(h.add).toHaveBeenCalledWith('tab2', [{ productId: 'p1', quantity: 1, notes: 'ao ponto' }], expect.stringMatching(/^[0-9a-f-]{36}$/)))
  })
  it('fecha a conta só quando os pagamentos batem com o total', async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: /Mesa 04/ }))
    const dialog = await screen.findByRole('dialog')
    const fechar = await within(dialog).findByRole('button', { name: 'Fechar comanda' })
    expect(fechar).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Valor total' }))
    expect(fechar).toBeEnabled()
    fireEvent.click(fechar)
    await vi.waitFor(() => expect(h.close).toHaveBeenCalledWith('tab4', [{ method: 'pix', amountCents: 3000 }], 0, expect.any(String)))
  })
  it('atendente sem caixa não fecha a conta e não configura mesas', async () => {
    show(['tabs.manage'])
    expect(screen.queryByRole('button', { name: /Configurar mesas/ })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /Mesa 02/ }))
    expect(await screen.findByText('O fechamento é feito por quem opera o caixa.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar fechamento' }))
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledWith('tab2'))
  })
})
