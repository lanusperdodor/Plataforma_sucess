import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ add: vi.fn(), cost: vi.fn(), missing: 2 }))
const fin = () => ({ hoje_cents: 2200, mes_cents: 4400, pedidos: 2, ticket_medio_cents: 2200, cancelados: 1, faturamento_bruto_cents: 4400, comissao_cents: 0,
  taxas_entrega_cents: 600, custo_produtos_cents: h.missing ? 0 : 1800, itens_sem_custo: h.missing, vendas_itens_com_custo_cents: h.missing ? 0 : 4400,
  despesas_cents: 105000, despesas_por_categoria: { aluguel: 100000 }, recebido_na_entrega_cents: 0, caixa_hoje: { pix_on_delivery: 2600 } })
vi.mock('../../features/merchant/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../../features/merchant/repository.ts')>()),
  getMerchantFinance: () => Promise.resolve(fin()),
  listExpenses: () => Promise.resolve([]),
  addExpense: (...a: unknown[]) => { h.add(...a); return Promise.resolve() },
  listProductCosts: () => Promise.resolve([{ productId: 'p1', name: 'Cheeseburger', priceCents: 2200, costCents: null }]),
  setProductCost: (...a: unknown[]) => { h.cost(...a); return Promise.resolve() },
}))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { CashTab, ExpensesTab, ProfitTab, profitOf } from './MerchantFinance.tsx'

afterEach(cleanup)
const show = (el: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>)

describe('finanças do lojista', () => {
  it('caixa mostra vendas de hoje/mês, ticket e caixa por forma de pagamento', async () => {
    show(<CashTab businessId="b1" />)
    expect(await screen.findByText('Pix na entrega')).toBeInTheDocument()
    expect(screen.getByText('Vendido no mês').nextSibling).toHaveTextContent('R$ 44,00')
  })
  it('registra gasto com categoria, valor, data e recorrência', async () => {
    show(<ExpensesTab businessId="b1" />)
    fireEvent.change(screen.getByLabelText('Categoria'), { target: { value: 'aluguel' } })
    fireEvent.change(screen.getByLabelText('Valor (R$)'), { target: { value: '1.000,00' } })
    fireEvent.change(screen.getByLabelText('Recorrência'), { target: { value: 'mensal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar gasto' }))
    await vi.waitFor(() => expect(h.add).toHaveBeenCalledWith('b1', expect.objectContaining({ category: 'aluguel', amount: '1.000,00', recurrence: 'mensal' })))
  })
  it('lucro avisa quando faltam custos e salva o custo do produto', async () => {
    show(<ProfitTab businessId="b1" />)
    expect(await screen.findByText(/sem custo cadastrado/)).toBeInTheDocument()
    expect(screen.getByText(/Lucro estimado no período \(incompleto\)/)).toBeInTheDocument()
    fireEvent.change(await screen.findByLabelText('Custo de Cheeseburger'), { target: { value: '9,00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await vi.waitFor(() => expect(h.cost).toHaveBeenCalledWith('b1', 'p1', '9,00'))
  })
  it('fórmula: receita − taxas − custos − despesas', () => {
    h.missing = 0
    const p = profitOf(fin() as never)
    expect(p).toEqual({ taxas: 600, receitaLiquida: 3800, margemBruta: 2600, resultado: 3800 - 1800 - 105000, completo: true })
  })
})
