import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  cities: [] as unknown[],
  fail: false,
  remote: null as unknown[] | null,
  search: vi.fn(),
}))

vi.mock('../../features/catalog/repository', () => ({
  listCities: () => (h.fail ? Promise.reject(new Error('x')) : Promise.resolve(h.cities)),
  getCityById: () => Promise.resolve(null),
  searchCities: (term: string, uf: string | null) => { h.search(term, uf); return Promise.resolve(h.remote) },
}))
vi.mock('../../features/catalog/repository.ts', () => ({
  listCities: () => (h.fail ? Promise.reject(new Error('x')) : Promise.resolve(h.cities)),
  getCityById: () => Promise.resolve(null),
  searchCities: (term: string, uf: string | null) => { h.search(term, uf); return Promise.resolve(h.remote) },
}))

import { CITY_KEY, setStoredCityId } from '../../features/location/cityStore.ts'
import { LocationPicker } from './LocationPicker.tsx'

const city = (id: string, name: string) => ({
  id,
  name,
  state: 'MG',
  slug: id,
  centerLat: null,
  centerLng: null,
})

const view = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocationPicker />
    </QueryClientProvider>,
  )

beforeEach(() => {
  h.fail = false
  h.remote = null
  h.search.mockClear()
  h.cities = [city('c1', 'Itaú de Minas'), city('c2', 'Passos')]
  window.localStorage.clear()
  setStoredCityId(null)
})
afterEach(cleanup)

describe('LocationPicker', () => {
  it('mostra a primeira cidade, abre, seleciona e grava', async () => {
    view()
    const trigger = screen.getByRole('button', { name: /Itaú de Minas, MG/ })
    await waitFor(() => expect(trigger).not.toHaveTextContent('Demonstração'))
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Escolha sua cidade' })
    expect(dialog).toBeInTheDocument()
    const options = within(screen.getByRole('radiogroup', { name: 'Cidades' })).getAllByRole('radio')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('radio', { name: /Passos, MG/ }))
    expect(window.localStorage.getItem(CITY_KEY)).toBe('"c2"')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByRole('button', { name: /Passos, MG/ })).toBeInTheDocument()
  })

  it('mostra erro com opção de tentar novamente', async () => {
    h.fail = true
    view()
    fireEvent.click(screen.getByRole('button', { name: /MG/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar as cidades')
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
  })

  it('usa Itaú de Minas como padrão mesmo fora da ordem alfabética, busca sem acento e agrupa por estado', async () => {
    const names = ['Alpinópolis', 'Areado', 'Cássia', 'Franca', 'Guaxupé', 'Itaú de Minas', 'Passos', 'São José da Barra', 'São José do Rio Pardo']
    h.cities = names.map((n, i) => ({ ...city(`c${i}`, n), state: n === 'Franca' || n === 'São José do Rio Pardo' ? 'SP' : 'MG' }))
    view()
    const trigger = await screen.findByRole('button', { name: /Itaú de Minas, MG/ })
    fireEvent.click(trigger)
    expect(screen.getByText('Minas Gerais')).toBeInTheDocument()
    expect(screen.getByText('São Paulo')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar cidade' }), { target: { value: 'sao jose' } })
    const radios = () => within(screen.getByRole('radiogroup', { name: 'Cidades' })).getAllByRole('radio')
    expect(radios().map((r) => r.textContent)).toEqual(['São José da Barra, MG', 'São José do Rio Pardo, SP'])
    fireEvent.click(screen.getByRole('radio', { name: 'SP' }))
    expect(radios().map((r) => r.textContent)).toEqual(['São José do Rio Pardo, SP'])
    fireEvent.click(screen.getByRole('radio', { name: 'Todas' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar cidade' }), { target: { value: 'cassia' } })
    expect(radios()).toHaveLength(1)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar cidade' }), { target: { value: 'xyz' } })
    expect(screen.getByText(/Nenhuma cidade encontrada/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Limpar busca' }))
    expect(radios().length).toBe(names.length)
  })

  it('com milhares de cidades, busca no banco depois de parar de digitar e mostra só os resultados', async () => {
    h.remote = [{ ...city('x1', 'São Sebastião do Paraíso') }]
    view()
    fireEvent.click(await screen.findByRole('button', { name: /Itaú de Minas, MG/ }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar cidade' }), { target: { value: 'Sao Sebastiao' } })
    expect(await screen.findByRole('radio', { name: /São Sebastião do Paraíso, MG/ })).toBeInTheDocument()
    expect(h.search).toHaveBeenCalledWith('sao sebastiao', null)
    expect(h.search).toHaveBeenCalledTimes(1)
  })
})
