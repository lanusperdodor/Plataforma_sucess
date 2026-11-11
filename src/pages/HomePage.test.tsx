import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const empty = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() }

vi.mock('../features/location/cityStore.ts', () => ({
  useCurrentCity: () => ({
    city: { id: 'c1', name: 'Itaú de Minas' },
    cities: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    setCity: vi.fn(),
  }),
}))
vi.mock('../features/catalog/hooks.ts', () => ({
  useCategories: () => ({
    ...empty,
    data: [{ id: 'k1', slug: 'pizza', label: 'Pizza', kind: 'restaurante', icon: 'Pizza', sortOrder: 1 }],
  }),
  useRestaurants: () => ({ ...empty, data: { pages: [{ items: [], nextPage: null }] } }),
  useFeatured: () => ({ ...empty, data: [] }),
}))

import { HomePage, categoryHref } from './HomePage.tsx'

afterEach(cleanup)

describe('HomePage', () => {
  it('mostra propósito, CTAs, busca e categorias', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Da sua cidade. Do seu jeito.' })).toBeInTheDocument()
    expect(screen.getByText('Peça, descubra, acompanhe e conecte-se com o comércio local.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Restaurantes' })).toHaveAttribute('href', '/restaurantes')
    expect(screen.getByRole('link', { name: 'Lojas' })).toHaveAttribute('href', '/lojas')
    expect(screen.getByRole('link', { name: 'Serviços' })).toHaveAttribute('href', '/servicos')
    expect(screen.queryByRole('link', { name: /Comunidade|Conecta/ })).toBeNull()
    expect(screen.getByPlaceholderText('Busque restaurantes, lojas e serviços…')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^Pizza$/ })).toHaveAttribute('href', '/restaurantes?categoria=pizza')
  })

  it('mapeia categorias para a listagem correta', () => {
    expect(categoryHref({ kind: 'loja', slug: 'moda' })).toBe('/lojas?categoria=moda')
    expect(categoryHref({ kind: 'servico', slug: 'x' })).toBe('/servicos?categoria=x')
    expect(categoryHref({ kind: 'vaga', slug: 'x' })).toBe('/vagas')
  })
})
