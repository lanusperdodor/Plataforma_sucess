import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { businessRowSchema, type BusinessSummary } from '../../features/catalog/schemas'
import { BusinessCard } from './BusinessCard'

afterEach(cleanup)

function make(over: Record<string, unknown> = {}): BusinessSummary {
  return businessRowSchema.parse({
    id: 'b1',
    name: 'Sabor da Praça',
    slug: 'sabor-da-praca',
    business_type: 'restaurante',
    category_id: null,
    city_id: null,
    description: null,
    cover_url: null,
    logo_url: null,
    address_line: null,
    phone: null,
    whatsapp: null,
    lat: null,
    lng: null,
    distance_estimate_km: 2.4,
    delivery_offer: 'own',
    own_delivery_fee_cents: 550,
    accepts_pickup: true,
    estimated_min_minutes: 30,
    estimated_max_minutes: 45,
    min_order_cents: 0,
    price_tier: 2,
    rating_avg: 4.6,
    rating_count: 12,
    popularity_score: 1,
    is_featured: false,
    is_demo: true,
    is_open: true,
    ...over,
  })
}

const renderCard = (b: BusinessSummary, extra: Record<string, unknown> = {}) =>
  render(
    <MemoryRouter>
      <BusinessCard business={b} categoryLabel="Lanches" {...extra} />
    </MemoryRouter>,
  )

describe('BusinessCard', () => {
  it('mostra os campos principais e um único link', () => {
    renderCard(make())
    expect(screen.getByRole('link', { name: 'Sabor da Praça' })).toHaveAttribute(
      'href',
      '/restaurantes/sabor-da-praca',
    )
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByText('Lanches')).toBeInTheDocument()
    expect(screen.getByText('4,6')).toBeInTheDocument()
    expect(screen.getByText('30–45 min')).toBeInTheDocument()
    expect(screen.getByText('Entrega própria R$ 5,50')).toBeInTheDocument()
    expect(screen.getByTestId('cover-fallback')).toBeInTheDocument()
  })

  it('mostra Aberto/Fechado em texto', () => {
    renderCard(make())
    expect(screen.getByText('Aberto')).toBeInTheDocument()
    cleanup()
    renderCard(make({ is_open: false }))
    expect(screen.getByText('Fechado')).toBeInTheDocument()
  })

  it('rotula demo e estimativa de distância; selo de promoção só com prop', () => {
    renderCard(make())
    expect(screen.getByText('Demonstração')).toBeInTheDocument()
    expect(screen.getByText('≈ 2,4 km do centro (estimativa)')).toBeInTheDocument()
    expect(screen.queryByText('Frete grátis')).toBeNull()
    cleanup()
    renderCard(make({ is_demo: false }), { promotion: { label: 'Frete grátis' } })
    expect(screen.queryByText('Demonstração')).toBeNull()
    expect(screen.getByText('Frete grátis')).toBeInTheDocument()
  })

  it('usa rota de loja e texto de retirada', () => {
    renderCard(make({ business_type: 'loja', delivery_offer: 'none' }))
    expect(screen.getByRole('link')).toHaveAttribute('href', '/lojas/sabor-da-praca')
    expect(screen.getByText('Só retirada')).toBeInTheDocument()
  })
})
