import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ set: vi.fn(), geo: vi.fn(), geoResult: null as unknown, loc: { lat: null as number | null, lng: null as number | null, address: 'Rua A, 10' as string | null } }))
vi.mock('../../features/gestao/repository.ts', () => ({
  getStoreLocation: () => Promise.resolve(h.loc),
  setStoreLocation: (...a: unknown[]) => { h.set(...a); return Promise.resolve() },
}))
vi.mock('../../features/address/repository.ts', () => ({
  getBusinessAddress: () => Promise.resolve({ cep: '37975000', street: 'Rua das Flores', number: '120', complement: '', district: 'Centro', city: 'Itaú de Minas', uf: 'MG' }),
}))
vi.mock('../../features/rastreamento/repository.ts', () => ({
  geocodeAddress: (...a: unknown[]) => { h.geo(...a); return h.geoResult ? Promise.resolve(h.geoResult) : Promise.reject(new Error('Endereço não encontrado com precisão.')) },
}))
vi.mock('../../components/map/LocationPickerMap.tsx', () => ({ default: () => <div>mapa</div> }))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { StoreLocationCard } from './StoreLocationCard.tsx'

afterEach(() => { cleanup(); h.set.mockReset() })
const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><StoreLocationCard businessId="b1" /></QueryClientProvider>)

describe('Local da loja no mapa', () => {
  it('avisa quando não está marcado e salva a localização do aparelho', async () => {
    h.loc = { lat: null, lng: null, address: 'Rua A, 10' }
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: -20.0812345, longitude: -44.5812345 } } as GeolocationPosition) } })
    show()
    expect(await screen.findByText(/Ainda não marcado/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /usar minha localização/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Salvar local' }))
    await waitFor(() => expect(h.set).toHaveBeenCalledWith('b1', -20.081235, -44.581235))
  })
  it('mostra que está marcado', async () => {
    h.loc = { lat: -20.08, lng: -44.58, address: null }
    show()
    expect(await screen.findByText(/Marcado\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ajustar local' })).toBeInTheDocument()
  })
  it('pelo endereço digitado: busca com as partes, mostra no mapa e salva', async () => {
    h.loc = { lat: null, lng: null, address: 'Rua das Flores, 120' }
    h.geoResult = { lat: -20.7412, lng: -46.7512, approx: false, label: 'Rua das Flores, 120' }
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar local da loja' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Buscar pelo endereço' }))
    await waitFor(() => expect(h.geo).toHaveBeenCalledWith(expect.stringContaining('Rua das Flores'), null, expect.objectContaining({ approx: true, parts: expect.objectContaining({ city: 'Itaú de Minas', uf: 'MG' }) })))
    fireEvent.click(await screen.findByRole('button', { name: 'Salvar local' }))
    await waitFor(() => expect(h.set).toHaveBeenCalledWith('b1', -20.7412, -46.7512))
  })
  it('endereço não achado: explica e permite colar a coordenada (ou link do Google Maps)', async () => {
    h.loc = { lat: null, lng: null, address: null }
    h.geoResult = null
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar local da loja' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Buscar pelo endereço' }))
    expect(await screen.findByText(/Marque no mapa ou cole a coordenada/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Coordenada' }))
    fireEvent.change(screen.getByLabelText('Coordenada ou link do Google Maps'), { target: { value: 'https://www.google.com/maps/@-20.7371,-46.7524,17z' } })
    fireEvent.click(screen.getByRole('button', { name: 'Usar esta coordenada' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Salvar local' }))
    await waitFor(() => expect(h.set).toHaveBeenCalledWith('b1', -20.7371, -46.7524))
  })
})
