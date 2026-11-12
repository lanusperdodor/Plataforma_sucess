import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ open: false, openCash: vi.fn(), move: vi.fn() }))
vi.mock('../../features/gestao/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../../features/gestao/repository.ts')>()),
  getCashStatus: () => Promise.resolve(h.open ? { open: true, session_id: 's1', opened_at: '2026-11-12T12:00:00Z', opened_by: 'Ana Caixa' } : { open: false }),
  getCashReport: () => Promise.resolve({ id: 's1', status: 'aberto', opened_at: '2026-11-12T12:00:00Z', closed_at: null, opening_cents: 10000, opened_by: 'Ana Caixa', closed_by: null,
    expected_cash_cents: 13000, counted_cents: null, difference_cents: null, by_kind: { venda: 3000 }, by_method: { dinheiro: 3000 },
    movements: [{ kind: 'venda', method: 'dinheiro', amount_cents: 3000, description: 'Comanda #21', confirmation: 'manual', at: '2026-11-12T12:30:00Z', by: 'Ana Caixa' }] }),
  openCash: (...a: unknown[]) => { h.openCash(...a); return Promise.resolve('s1') },
  cashMovement: (...a: unknown[]) => { h.move(...a); return Promise.resolve('m1') },
}))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { CashRegisterTab } from './CashRegisterTab.tsx'
import { GestaoContext, type GestaoCtx } from './context.ts'

afterEach(cleanup)
const ctx: GestaoCtx = { business: { id: 'b1', name: 'R' } as GestaoCtx['business'], niche: 'restaurante', plan: undefined, premium: true, can: () => true }
const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GestaoContext.Provider value={ctx}><CashRegisterTab /></GestaoContext.Provider></QueryClientProvider>)

describe('Caixa presencial', () => {
  it('abre o caixa com saldo inicial', async () => {
    h.open = false
    show()
    fireEvent.change(await screen.findByLabelText('Saldo inicial (R$)'), { target: { value: '100,00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir caixa' }))
    await vi.waitFor(() => expect(h.openCash).toHaveBeenCalledWith('b1', 10000))
  })
  it('caixa aberto mostra movimentações, esperado e exige motivo na sangria', async () => {
    h.open = true
    show()
    expect(await screen.findByText('Comanda #21')).toBeInTheDocument()
    expect(screen.getByText('Esperado em dinheiro').nextSibling).toHaveTextContent('R$ 130,00')
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'sangria' } })
    expect(screen.getByLabelText('Descrição')).toBeRequired()
    fireEvent.change(screen.getByLabelText('Valor (R$)'), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Depósito no banco' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar' }))
    await vi.waitFor(() => expect(h.move).toHaveBeenCalledWith('b1', 'sangria', 'dinheiro', 5000, 'Depósito no banco', expect.any(String)))
  })
})
