import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../features/admin/repository.ts', () => ({
  getFinanceSummary: () => Promise.resolve({ activeBusinesses: 3, activeSubscriptions: 2, mrrCents: 17800, receivedMonthCents: 9900, receivedTotalCents: 19800, openCents: 7900, overdueCents: 0, feesMonthCents: 340, dueSoon: 1 }),
  listFinanceBusinesses: () => Promise.resolve([{ businessId: 'b1', name: 'Lanchonete F', slug: 'l', businessType: 'restaurante', status: 'active', city: 'Passos - MG', ownerName: 'Ana Souza', phone: '(35) 3000-0000', whatsapp: '(35) 97777-0000', subscriptionId: 's1', planCode: 'presencial_delivery', planName: 'Presencial + Delivery', priceCents: 9900, startedOn: '2026-10-01', periodEnd: '2099-12-01', openCents: 0, overdueCents: 0, lastPaidAt: null, feesMonthCents: 340 }]),
  listCharges: () => Promise.resolve([]),
  getFinanceSeries: () => Promise.resolve([{ month: '2026-10-01', receivedCents: 0, feesCents: 340, newSubscriptions: 0 }, { month: '2026-11-01', receivedCents: 9900, feesCents: 0, newSubscriptions: 1 }]),
  getFinanceByPlan: () => Promise.resolve([{ planCode: 'delivery', planName: 'Delivery', businesses: 1, mrrCents: 7900 }, { planCode: null, planName: 'Sem plano', businesses: 2, mrrCents: 0 }]),
  listPlans: () => Promise.resolve([]),
  listCities: () => Promise.resolve([]),
  financeReport: () => Promise.resolve({
    confirmado: { pedidos: 2, volume_bruto_cents: 12400, produtos_cents: 11600, comissao_cents: 232, taxas_plataforma_cents: 200, devido_entregadores_cents: 1000, logistica_estabelecimentos_cents: 400 },
    previsto: { pedidos: 1, volume_bruto_cents: 6200, comissao_cents: 116, taxas_plataforma_cents: 100 },
    cancelados: { pedidos: 0, volume_cents: 0 },
    mensalidades: { recebido_cents: 9900, recebido_online_cents: 0, a_receber_cents: 7900, vencido_cents: 0 },
    repassado: { entregadores_cents: 0, registrado: false }, reembolsos: { cents: 0, registrado: false },
    por_estabelecimento: [], por_cidade: [{ cidade: 'Passos - MG', pedidos: 2, volume_cents: 12400 }],
  }),
  financeTransactions: () => Promise.resolve([{ kind: 'pedido', ref: 'ABC123', at: '2026-11-11T12:00:00Z', business: 'Lanchonete F', city: 'Passos - MG', description: 'Pedido (entregador parceiro)',
    status: 'delivered', amountCents: 6200, platformCents: 216, courierCents: 500, method: 'cash', total: 1 }]),
}))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('./access-context.ts', () => ({ useAdminAccess: () => ({ isMaster: true, mfaOk: true }) }))

import { AdminFinance, brlShort, daysUntil, waLink } from './AdminFinance.tsx'
import { niceMax } from './charts.tsx'

afterEach(cleanup)

describe('financeiro', () => {
  it('vencimento e link de WhatsApp com mensagem', () => {
    const now = new Date('2026-11-11T12:00:00')
    expect(daysUntil('2026-11-11', now)).toBe(0)
    expect(daysUntil('2026-11-18', now)).toBe(7)
    expect(daysUntil('2026-11-01', now)).toBeLessThan(0)
    expect(waLink('(35) 97777-0000', 'Olá')).toBe('https://wa.me/5535977770000?text=Ol%C3%A1')
    expect(waLink('123', 'x')).toBeNull()
  })
  it('mostra resumo, plano, vencimento e botão de WhatsApp', async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AdminFinance /></QueryClientProvider>)
    expect(await screen.findByText('R$ 178,00')).toBeInTheDocument()
    expect(screen.getAllByText('Lanchonete F').length).toBeGreaterThan(0)
    expect(await screen.findByText('Receita da plataforma')).toBeInTheDocument()
    expect(screen.getByText('R$ 4,32')).toBeInTheDocument()
    expect(await screen.findByText(/#ABC123/)).toBeInTheDocument()
    expect(screen.getByText(/Presencial \+ Delivery · R\$ 99,00\/mês/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', expect.stringContaining('https://wa.me/5535977770000'))
    expect(screen.getByRole('button', { name: 'Gerar mensalidade' })).toBeInTheDocument()
    expect((await screen.findAllByText('Recebido por mês (últimos 12 meses)')).length).toBeGreaterThan(0)
    expect(screen.getByRole('img', { name: /Recebido por mês/ })).toBeInTheDocument()
    expect(screen.getByText('2 empresas')).toBeInTheDocument()
    expect(screen.getAllByText('novembro de 2026').length).toBeGreaterThan(0) // tabela equivalente
  })
  it('escala do eixo e valores compactos', () => {
    expect(niceMax(0)).toBe(1)
    expect(niceMax(9900)).toBe(10000)
    expect(niceMax(13200)).toBe(20000)
    expect(brlShort(990000)).toBe('R$ 9,9 mil')
    expect(brlShort(7900)).toBe('R$ 79')
  })
})
