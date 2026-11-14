import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  tracking: null as unknown,
  mapProps: null as Record<string, unknown> | null,
  routeFail: null as string | null,
  steps: [] as unknown[],
  gps: null as ((p: GeolocationPosition) => void) | null,
}))
const base = {
  leg: 'entrega', viewer: 'entregador', status: 'out_for_delivery', vehicle: 'moto',
  business: { name: 'Lanchonete', address: 'Av. Principal, 50', lat: -20.084, lng: -44.578 },
  destination: { lat: -20.072, lng: -44.578 },
  position: null,
  // rota reta para o norte: 1.334 m
  route: { leg: 'entrega', geometry: [[-44.578, -20.084], [-44.578, -20.072]], distance_m: 1334, duration_s: 267, provider: 'openrouteservice', computed_at: '2026-11-14T10:00:00Z' },
  server_time: new Date().toISOString(),
}
vi.mock('../../features/rastreamento/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../../features/rastreamento/repository.ts')>()),
  getTracking: () => Promise.resolve(h.tracking),
  getRouteSteps: () => Promise.resolve(h.steps),
  sendLocation: () => Promise.resolve('entrega'),
  stopSharing: () => Promise.resolve(),
  requestRoute: () => (h.routeFail ? Promise.reject(new Error(h.routeFail)) : Promise.resolve({ distanceM: 1, durationS: 1 })),
  subscribeTracking: () => () => undefined,
}))
vi.mock('../../components/map/NavigationMap.tsx', () => ({ default: (p: Record<string, unknown>) => { h.mapProps = p; return <div data-testid="mapa-navegacao" /> } }))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { LiveLocation } from './LiveLocation.tsx'

const fixAt = (lat: number) => ({ coords: { latitude: lat, longitude: -44.578, accuracy: 6, heading: 0, speed: 8, altitude: null, altitudeAccuracy: null }, timestamp: Date.now() } as unknown as GeolocationPosition)
beforeEach(() => {
  h.tracking = base; h.routeFail = null; h.mapProps = null
  h.steps = [
    { text: 'Siga pela Av. Principal', type: 'depart', distance_m: 600, at: null },
    { text: 'Vire à direita na Rua das Flores', type: 'turn-right', distance_m: 734, at: null },
    { text: 'Você chegou', type: 'arrive', distance_m: 0, at: null },
  ]
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition: (ok: (p: GeolocationPosition) => void) => { h.gps = ok; return 1 }, clearWatch: vi.fn() } })
})
afterEach(cleanup)
const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
  <LiveLocation orderId="o1" pickupAddress="Av. Principal, 50" dropoffAddress="Rua das Flores, 120" pickupName="Lanchonete" dropoffName="Ana" payCents={600} /></QueryClientProvider>)

describe('entregador: navegação dentro da Tucaí', () => {
  it('abrir a navegação liga o GPS, mostra o mapa, a próxima conversão, distância e tempo restantes', async () => {
    show()
    const btn = await screen.findByRole('button', { name: 'Navegar até o cliente' })
    fireEvent.click(btn)
    expect(await screen.findByTestId('mapa-navegacao')).toBeInTheDocument()
    // GPS a ~300 m do início da rota (faltam ~1.030 m)
    act(() => h.gps!(fixAt(-20.0813)))
    expect(await screen.findByText('Vire à direita na Rua das Flores')).toBeInTheDocument()
    expect(screen.getByText('Em 300 m')).toBeInTheDocument()
    expect(screen.getByText('1,0 km')).toBeInTheDocument()
    expect(screen.getByText('3 min')).toBeInTheDocument()
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Entrega')
    expect(screen.getByText('R$ 6,00')).toBeInTheDocument()
    expect(h.mapProps).toMatchObject({ vehicle: 'moto', position: [-44.578, -20.0813], heading: 0, follow: true })
    expect(screen.queryByRole('link', { name: /Google Maps/ })).not.toBeInTheDocument()
  })

  it('rota não encontrada: avisa e oferece a rota no OpenStreetMap; distância vira aproximada', async () => {
    h.tracking = { ...base, route: null }
    h.routeFail = 'O cliente não marcou o ponto de entrega.'
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Navegar até o cliente' }))
    await act(async () => { h.gps!(fixAt(-20.0813)) })
    expect(await screen.findByText('O cliente não marcou o ponto de entrega.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir a rota no OpenStreetMap' })).toHaveAttribute('href', expect.stringContaining('openstreetmap.org/directions'))
    expect(screen.getByText('aproximado')).toBeInTheDocument()
  })

  it('sem internet e sem GPS: avisos claros', async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Navegar até o cliente' }))
    act(() => { window.dispatchEvent(new Event('offline')) })
    expect(await screen.findByText(/Sem internet/)).toBeInTheDocument()
    act(() => { window.dispatchEvent(new Event('online')) })
    expect(screen.queryByText(/Sem internet/)).not.toBeInTheDocument()
  })
})
