import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { businessRowSchema } from '../features/catalog/schemas.ts'

const h = vi.hoisted(() => ({ business: null as unknown }))
vi.mock('../features/store/repository.ts', () => ({
  getPublicBusiness: () => Promise.resolve(h.business),
  getMenu: () =>
    Promise.resolve([{ id: 'c1', name: 'Lanches', products: [{ id: 'p1', name: 'X-Burger', description: null, priceCents: 2400, imageUrl: null, isAvailable: false, groups: [] }] }]),
  getReviews: () => Promise.resolve([]),
}))
vi.mock('../features/catalog/hooks.ts', () => ({
  useCategories: () => ({ data: [] }),
  useBusinessHours: () => ({ data: [{ weekday: 1, opens: '18:00', closes: '23:00' }], isError: false }),
}))

vi.mock('../features/auth/AuthProvider.tsx', () => ({ useAuth: () => ({ session: null }) }))
vi.mock('./ConectaPage.tsx', () => ({ Feed: () => <p>feed do estabelecimento</p> }))

import { BusinessPage } from './BusinessPage.tsx'

const row = {
  id: 'b1', name: 'Lanchonete Real', slug: 'lanchonete-real', business_type: 'restaurante', category_id: null, city_id: 'c1',
  description: 'Lanches na chapa', cover_url: null, logo_url: null, address_line: 'Rua A, 10', phone: '(35) 3000-0000', whatsapp: null,
  lat: null, lng: null, distance_estimate_km: null, delivery_offer: 'own', own_delivery_fee_cents: 500, accepts_pickup: true,
  estimated_min_minutes: null, estimated_max_minutes: null, min_order_cents: 0, price_tier: null, rating_avg: 0, rating_count: 0,
  popularity_score: 0, is_featured: false, is_open: false,
}

const view = (path = '/restaurantes/lanchonete-real') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/restaurantes/:slug" element={<BusinessPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

afterEach(cleanup)

describe('página pública do estabelecimento', () => {
  it('mostra dados reais, cardápio com indisponível, horários e nenhuma avaliação inventada', async () => {
    h.business = businessRowSchema.parse(row)
    view()
    expect(await screen.findByRole('heading', { level: 1, name: 'Lanchonete Real' })).toBeInTheDocument()
    expect(await screen.findByText('X-Burger')).toBeInTheDocument()
    expect(screen.getByText('Indisponível')).toBeInTheDocument()
    expect(screen.getByText('Fechado agora')).toBeInTheDocument()
    expect(screen.getByText('18:00–23:00')).toBeInTheDocument()
    expect(screen.getByText('Sem avaliações ainda')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ligar/ })).toHaveAttribute('href', 'tel:3530000000')
    expect(screen.getByRole('note')).toHaveTextContent(/Peça pela Tucaí|Fechado agora|ainda não ativou|fale direto/i)
    expect(screen.getByRole('link', { name: 'Entre para seguir' })).toHaveAttribute('href', '/entrar')
    expect(screen.getByText('feed do estabelecimento')).toBeInTheDocument()
  })
  it('estabelecimento inexistente ou inativo mostra "não encontrado"', async () => {
    h.business = null
    view('/restaurantes/nao-existe')
    expect(await screen.findByText('Estabelecimento não encontrado')).toBeInTheDocument()
  })
})
