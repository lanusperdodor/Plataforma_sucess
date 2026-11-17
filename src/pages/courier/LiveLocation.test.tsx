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
  geo: vi.fn(), setPoint: vi.fn(), route: vi.fn(),
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
  requestRoute: (...a: unknown[]) => (h.route(...a), h.routeFail ? Promise.reject(new Error(h.routeFail)) : Promise.resolve({ distanceM: 1, durationS: 1 })),
  subscribeTracking: () => () => undefined,
  geocodeAddress: (...a: unknown[]) => { h.geo(...a); return Promise.resolve({ lat: -20.072, lng: -44.578 }) },
  courierSetPointFromAddress: (...a: unknown[]) => { h.setPoint(...a); return Promise.resolve() },
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
  it('coleta: um botão "Traçar rota até o restaurante" a partir de onde o entregador está; o mapa mostra só a loja', async () => {
    h.tracking = { ...base, leg: 'coleta', status: 'accepted', route: null }
    h.route.mockClear()
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      watchPosition: (ok: (p: GeolocationPosition) => void) => { h.gps = ok; return 1 }, clearWatch: vi.fn(),
      getCurrentPosition: (ok: (p: GeolocationPosition) => void) => ok(fixAt(-20.09)),
    } })
    show()
    expect(screen.queryByRole('button', { name: /até o cliente/ })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Traçar rota até o restaurante' }))
    await vi.waitFor(() => expect(h.route).toHaveBeenCalledWith('o1', 'coleta', { lat: -20.09, lng: -44.578 }))
    expect(await screen.findByTestId('mapa-navegacao')).toBeInTheDocument()
    expect(h.mapProps).toMatchObject({ destination: null, store: [-44.578, -20.084] })
  })

  it('entrega: "Traçar rota até o cliente" sai do restaurante (sem ponto do aparelho)', async () => {
    h.tracking = { ...base, route: null }
    h.route.mockClear()
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Traçar rota até o cliente' }))
    await vi.waitFor(() => expect(h.route).toHaveBeenCalledWith('o1', 'entrega', null))
  })

  it('abrir a navegação liga o GPS, mostra o mapa, a próxima conversão, distância e tempo restantes', async () => {
    show()
    // já há rota da entrega: abre o mapa sem calcular de novo
    expect(await screen.findByText(/Rota do restaurante \(Lanchonete\) até o cliente \(Ana\)/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir o mapa da rota' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Traçar rota até o cliente' }))
    await act(async () => { h.gps!(fixAt(-20.0813)) })
    expect(await screen.findByText(/Cálculo da rota: O cliente não marcou o ponto de entrega\./)).toBeInTheDocument()
    expect(screen.getByText('Por que a rota ainda não aparece')).toBeInTheDocument()
    expect(screen.getByText(/Sua localização: ok/)).toBeInTheDocument()
    expect(screen.getByText('Loja marcada no mapa: ok.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir a rota no OpenStreetMap' })).toHaveAttribute('href', expect.stringContaining('openstreetmap.org/directions'))
    expect(screen.getByText('aproximado')).toBeInTheDocument()
  })

  it('cliente não marcou o ponto: localiza pelo endereço digitado e grava o destino', async () => {
    h.tracking = { ...base, destination: null, route: null }
    h.route.mockClear(); h.setPoint.mockClear()
    show()
    fireEvent.click(await screen.findByRole('button', { name: /até o cliente/ }))
    await vi.waitFor(() => expect(h.geo).toHaveBeenCalledWith('Rua das Flores, 120', { lat: -20.084, lng: -44.578 }))
    await vi.waitFor(() => expect(h.setPoint).toHaveBeenCalledWith('o1', -20.072, -44.578))
    // a rota é traçada depois de localizar o cliente (não falha por falta do ponto)
    await vi.waitFor(() => expect(h.route).toHaveBeenCalledWith('o1', 'entrega', null))
    expect(h.setPoint.mock.invocationCallOrder[0]!).toBeLessThan(h.route.mock.invocationCallOrder.at(-1)!)
  })

  it('localização do computador (imprecisa): explica que no celular fica precisa', async () => {
    h.tracking = { ...base, route: null, business: { ...base.business, lat: null, lng: null } }
    show()
    fireEvent.click(await screen.findByRole('button', { name: /até o cliente/ }))
    await act(async () => { h.gps!({ coords: { latitude: -20.0813, longitude: -44.578, accuracy: 3500, heading: null, speed: null, altitude: null, altitudeAccuracy: null }, timestamp: Date.now() } as unknown as GeolocationPosition) })
    expect(await screen.findByText(/aproximada \(cerca de 3.5 km de erro\)/)).toBeInTheDocument()
    expect(screen.getByText(/Loja sem local no mapa/)).toBeInTheDocument()
  })

  it('sem internet e sem GPS: avisos claros', async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: /até o cliente/ }))
    act(() => { window.dispatchEvent(new Event('offline')) })
    expect(await screen.findByText(/Sem internet/)).toBeInTheDocument()
    act(() => { window.dispatchEvent(new Event('online')) })
    expect(screen.queryByText(/Sem internet/)).not.toBeInTheDocument()
  })
})
