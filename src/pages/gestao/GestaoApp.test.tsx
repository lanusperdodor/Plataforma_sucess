import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  role: 'owner' as string, premium: true,
  session: { user: { id: 'u1', email: 'dono@teste.dev' } },
}))
vi.mock('../../features/auth/AuthProvider.tsx', () => ({
  useAuth: () => ({ session: h.session, authz: { userId: 'u1', roles: ['business_owner'], memberships: [{ businessId: 'b1', role: h.role }] }, signOut: vi.fn() }),
}))
vi.mock('../../features/account/repository.ts', () => ({ getAccountIdentity: () => Promise.resolve({ fullName: 'Dono Teste', username: null, businesses: { b1: 'Restaurante Teste' } }), sendInviteLink: vi.fn() }))
vi.mock('../../features/catalog/hooks.ts', () => ({ useCategories: () => ({ data: [{ id: 'cat', label: 'Hamburgueria', slug: 'hamburgueria' }] }) }))
vi.mock('../../features/merchant/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../../features/merchant/repository.ts')>()),
  getBusiness: () => Promise.resolve({ id: 'b1', name: 'Restaurante Teste', slug: 'rt', status: 'active', businessType: 'restaurante', categoryId: 'cat', logoUrl: null, reviewNote: null }),
  listMyBusinesses: () => Promise.resolve([{ id: 'b1', name: 'Restaurante Teste', status: 'active' }]),
}))
vi.mock('../../features/gestao/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../../features/gestao/repository.ts')>()),
  getBusinessPlan: () => Promise.resolve(h.premium ? { code: 'presencial_delivery', name: 'Premium', premium: true, source: 'homologacao', periodEnd: null } : { code: 'delivery', name: 'Padrão', premium: false, source: 'assinatura', periodEnd: '2026-12-01' }),
  listMemberExtras: () => Promise.resolve([]),
  getCashStatus: () => Promise.resolve({ open: false }),
  getOverview: () => Promise.resolve({ premium: h.premium, recebidos_hoje: 3, concluidos_hoje: 1, cancelados_hoje: 0, em_andamento: 2, faturamento_hoje_cents: 2200,
    faturamento_mes_cents: 9900, ticket_medio_cents: 3300, recebido_mes_cents: 0, pendente_cents: 4400, taxas_mes_cents: 500, despesas_mes_cents: h.premium ? 1000 : null,
    serie: [{ dia: '2026-11-11', cents: 0 }, { dia: '2026-11-12', cents: 2200 }] }),
  getBoard: () => Promise.resolve([]),
}))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { LIVE_NOTIFICATION_EVENT } from '../../features/realtime/LiveUpdates.tsx'
import { GestaoApp } from './GestaoApp.tsx'

afterEach(cleanup)
const show = (path: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}><Routes><Route path="/painel/*" element={<GestaoApp />} /></Routes></MemoryRouter>
    </QueryClientProvider>,
  )

describe('Tucaí Gestão em tela cheia', () => {
  it('cabeçalho próprio com loja, nicho, plano, caixa e voltar; menu superior do restaurante', async () => {
    h.role = 'owner'; h.premium = true
    show('/painel/b1')
    expect(await screen.findByText('Restaurante Teste', { selector: 'p' })).toBeInTheDocument()
    expect(await screen.findByText(/Restaurante · Plano Premium \(homologação\)/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Voltar à Tucaí/ })).toHaveAttribute('href', '/')
    expect(await screen.findByText('Caixa fechado')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Módulos do Tucaí Gestão' })
    for (const l of ['Visão geral', 'Minha loja', 'Cardápio', 'Pedidos recebidos', 'Cozinha', 'Comandas e mesas', 'Caixa', 'Equipe', 'Relatórios', 'Configurações']) {
      expect(within(nav).getByRole('link', { name: new RegExp(l) })).toBeInTheDocument()
    }
    expect(within(nav).getByRole('link', { name: /Visão geral/ })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByText('Pedidos recebidos hoje')).toBeInTheDocument()
    // fora do marketplace: sem navegação inferior da Tucaí
    expect(screen.queryByRole('navigation', { name: /Navegação principal/i })).not.toBeInTheDocument()
  })
  it('URL direta de um módulo funciona; sem Premium mostra o convite ao plano', async () => {
    h.role = 'owner'; h.premium = false
    show('/painel/b1/mesas')
        expect(await screen.findByText('Comandas e mesas faz parte do plano Premium')).toBeInTheDocument()
  })
  it('atendente não vê Equipe, Caixa nem relatórios', async () => {
    h.role = 'attendant'; h.premium = true
    show('/painel/b1/pedidos')
    const nav = await screen.findByRole('navigation', { name: 'Módulos do Tucaí Gestão' })
    expect(within(nav).getByRole('link', { name: /Comandas e mesas/ })).toBeInTheDocument()
    for (const l of ['Equipe', 'Caixa', 'Relatórios', 'Meu lucro', 'Minha loja']) expect(within(nav).queryByRole('link', { name: new RegExp(`^${l}`) })).not.toBeInTheDocument()
  })
  it('pedido novo aparece como aviso discreto com Ver pedido e Fechar', async () => {
    h.role = 'owner'; h.premium = true
    show('/painel/b1/pedidos')
    await screen.findByRole('navigation', { name: 'Módulos do Tucaí Gestão' })
    let handled = false
    act(() => {
      handled = !window.dispatchEvent(new CustomEvent(LIVE_NOTIFICATION_EVENT, { cancelable: true, detail: { id: 'n1', kind: 'order_new', message: 'Novo pedido #1234 — 1× Cheeseburger', link: '/painel/b1/pedidos' } }))
    })
    expect(handled).toBe(true)
    expect(await screen.findByText('Novo pedido recebido!')).toBeInTheDocument()
    expect(screen.getByText('Pedido #1234 — 1× Cheeseburger')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver pedido' })).toBeInTheDocument()
    act(() => screen.getByRole('button', { name: 'Fechar' }).click())
    expect(screen.queryByText('Novo pedido recebido!')).not.toBeInTheDocument()
  })
})
