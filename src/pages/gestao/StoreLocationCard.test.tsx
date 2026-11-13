import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ set: vi.fn(), loc: { lat: null as number | null, lng: null as number | null, address: 'Rua A, 10' as string | null } }))
vi.mock('../../features/gestao/repository.ts', () => ({
  getStoreLocation: () => Promise.resolve(h.loc),
  setStoreLocation: (...a: unknown[]) => { h.set(...a); return Promise.resolve() },
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
    expect(screen.getByRole('button', { name: 'Ajustar no mapa' })).toBeInTheDocument()
  })
})
