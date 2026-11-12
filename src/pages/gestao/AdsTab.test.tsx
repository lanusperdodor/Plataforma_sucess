import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ create: vi.fn(), pay: vi.fn() }))
vi.mock('../../features/auth/AuthProvider.tsx', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } }, authz: null }) }))
vi.mock('../../features/conecta/repository.ts', () => ({
  listFeed: () => Promise.resolve({ posts: [{ id: 'p1', body: 'Promoção de hoje: cheeseburger em dobro!', hidden: false }], nextCursor: null }),
}))
vi.mock('../../features/regions/repository.ts', () => ({
  listActiveRegions: () => Promise.resolve([{ id: 'r1', name: 'Região de Itaú de Minas', uf: 'MG', center_name: 'Itaú de Minas', radius_km: 100, municipalities: 58 }]),
}))
vi.mock('../../features/payments/repository.ts', () => ({ createPaymentLink: (id: string) => { h.pay(id); return Promise.reject(new Error('sem gateway')) } }))
vi.mock('../../features/ads/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../../features/ads/repository.ts')>()),
  getAdQuote: (regions: string[], days: number, total: number) => Promise.resolve({ ok: total >= 1000, min_cents: 500 * days * regions.length < 1000 ? 1000 : 500 * days * regions.length,
    total_cents: total, daily_cents: Math.floor(total / days), min_days: 1, max_days: 30, max_regions: 10, regions: regions.length, valid_regions: regions.length, min_total_cents: 1000, min_daily_cents_per_region: 500 }),
  createCampaign: (a: unknown) => { h.create(a); return Promise.resolve({ campaign_id: 'c1', charge_id: 'ch1', amount_cents: 1000, repetida: false }) },
  listCampaigns: () => Promise.resolve([{ id: 'c0', post_id: 'p1', post_excerpt: 'Promoção antiga', objective: 'alcance', status: 'ativa', total_cents: 1000, days: 2, daily_cents: 500,
    regions: ['Região de Itaú de Minas'], starts_at: '2026-11-10T12:00:00Z', ends_at: '2026-11-12T12:00:00Z', paid: true, approved: true, review_note: null, charge_id: 'ch0', charge_status: 'paga',
    impressions: 120, clicks: 9, created_at: '2026-11-10T11:00:00Z' }]),
}))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { AdsTab } from './AdsTab.tsx'
import { GestaoContext, type GestaoCtx } from './context.ts'

afterEach(cleanup)
const ctx: GestaoCtx = { business: { id: 'b1', name: 'Mercadinho' } as GestaoCtx['business'], niche: 'mercadinho', plan: undefined, premium: true, can: () => true }
const show = (path = '/painel/b1/anuncios') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}><GestaoContext.Provider value={ctx}><AdsTab /></GestaoContext.Provider></MemoryRouter>
  </QueryClientProvider>,
)

describe('Anúncios do estabelecimento', () => {
  it('painel do anunciante mostra investimento, impressões e cliques', async () => {
    show()
    expect(await screen.findByText('“Promoção antiga”')).toBeInTheDocument()
    expect(screen.getByText(/120 impressões · 9 cliques · 7,5% de cliques/)).toBeInTheDocument()
    expect(screen.getByText('Investido (pago)').nextSibling).toHaveTextContent('R$ 10,00')
  })
  it('turbinar: R$ 10 por 2 dias = R$ 5/dia, preço final antes de contratar', async () => {
    show('/painel/b1/anuncios?post=p1')
    expect(await screen.findByRole('form', { name: 'Turbinar publicação' })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /Região de Itaú de Minas/ }))
    expect(await screen.findByText('R$ 5,00')).toBeInTheDocument()
    expect(screen.getByText(/Não há garantia de alcance/)).toBeInTheDocument()
    const btn = await screen.findByRole('button', { name: 'Contratar e pagar R$ 10,00' })
    await vi.waitFor(() => expect(btn).toBeEnabled())
    fireEvent.click(btn)
    await vi.waitFor(() => expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'b1', postId: 'p1', regions: ['r1'], days: 2, totalCents: 1000, opId: expect.any(String) })))
    await vi.waitFor(() => expect(h.pay).toHaveBeenCalledWith('ch1'))
  })
})
