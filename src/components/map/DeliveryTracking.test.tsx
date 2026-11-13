import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Tracking } from '../../features/rastreamento/repository.ts'

const h = vi.hoisted(() => ({ data: null as unknown }))
vi.mock('../../features/rastreamento/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../../features/rastreamento/repository.ts')>()),
  getTracking: () => Promise.resolve(h.data),
  subscribeTracking: () => () => undefined,
}))
vi.mock('../feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { DeliveryTracking, trackingSummary } from './DeliveryTracking.tsx'
import { STORE_AT, roadState } from './DeliveryRoad.tsx'

const left = () => parseFloat((screen.getByTestId('motinha') as HTMLElement).style.left)

afterEach(cleanup)
const base: Tracking = {
  leg: 'entrega', viewer: 'cliente', status: 'out_for_delivery', vehicle: 'moto',
  business: { name: 'Lanchonete', address: 'Rua B', lat: -20.08, lng: -44.57 },
  destination: { lat: -20.07, lng: -44.57 },
  position: { lat: -20.075, lng: -44.57, accuracy_m: 10, heading: null, speed_kmh: null, recorded_at: new Date(Date.now() - 10_000).toISOString(), received_at: new Date().toISOString() },
  route: { leg: 'entrega', geometry: [[-44.57, -20.08], [-44.57, -20.07]], distance_m: 1112, duration_s: 222, provider: 'openrouteservice', computed_at: new Date().toISOString() },
  server_time: new Date().toISOString(),
}
const renderIt = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DeliveryTracking orderId="o1" /></QueryClientProvider>)

describe('acompanhamento da entrega com a motinha', () => {
  it('ao vivo: mostra hora da atualização, distância e previsão calculadas sobre a rota real', async () => {
    h.data = base
    renderIt()
    expect(await screen.findByText(/Ao vivo · atualizado às/)).toBeInTheDocument()
    expect(screen.getByText('560 m')).toBeInTheDocument()
    expect(screen.getByText('2 min')).toBeInTheDocument()
    // metade da rota de entrega percorrida: a moto fica entre a loja e a casa, andando
    expect(screen.getByTestId('motinha').querySelector('.tucai-moto-bob')).not.toBeNull()
    expect(left()).toBeGreaterThan((0.05 + STORE_AT * 0.87) * 100)
    expect(left()).toBeLessThan(92)
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('A caminho')
    expect(screen.getByRole('img', { name: /Entrega: entregador a caminho do destino/ })).toBeInTheDocument()
  })

  it('GPS parado: avisa que está desatualizado, moto parada e sem previsão inventada', async () => {
    h.data = { ...base, position: { ...base.position!, recorded_at: new Date(Date.now() - 5 * 60_000).toISOString() } }
    renderIt()
    expect(await screen.findByText(/Localização desatualizada/)).toBeInTheDocument()
    expect(screen.queryByText(/min$/)).not.toBeInTheDocument()
    // GPS parado: a moto fica no último ponto conhecido, sem animação de andar
    expect(screen.getByTestId('motinha').querySelector('.tucai-moto-bob')).toBeNull()
  })

  it('sem posição ainda e sem ponto marcado: oferece marcar a localização', async () => {
    h.data = { ...base, status: 'preparing', leg: 'coleta', position: null, route: null, destination: null }
    renderIt()
    expect(await screen.findByText(/Aguardando a localização do entregador/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Usar minha localização' })).toBeInTheDocument()
  })

  it('antes da coleta explica a posição aproximada; pedido encerrado não mostra mapa', async () => {
    h.data = { ...base, leg: 'coleta', route: null }
    renderIt()
    expect(await screen.findByText(/aproximada \(cerca de 100 m\)/)).toBeInTheDocument()
    cleanup()
    h.data = { ...base, status: 'delivered' }
    const { container } = renderIt()
    await new Promise((r) => setTimeout(r, 20))
    expect(container.querySelector('section')).toBeNull()
  })

  it('resumo sem entregador atribuído', () => {
    expect(trackingSummary({ ...base, leg: null }, Date.now()).text).toMatch(/começa a andar quando um entregador assume/)
  })

  it('sem entregador: motinha parada na loja, etapa "Preparando"', async () => {
    h.data = { ...base, status: 'preparing', leg: null, position: null, route: null }
    renderIt()
    expect(await screen.findByRole('listitem', { current: 'step' })).toHaveTextContent('Preparando')
    expect(left()).toBeCloseTo((0.05 + STORE_AT * 0.87) * 100, 1)
  })

  it('posição na pista', () => {
    const b: [number, number] = [-44.57, -20.08], d: [number, number] = [-44.57, -20.07]
    expect(roadState({ leg: null, position: null, business: b, destination: d, remainingM: null, routeDistanceM: null, live: false })).toMatchObject({ stage: 'preparando', progress: STORE_AT, moving: false })
    const quase = roadState({ leg: 'entrega', position: [-44.57, -20.071], business: b, destination: d, remainingM: null, routeDistanceM: null, live: true })
    expect(quase.progress).toBeGreaterThan(0.9)
    const saindo = roadState({ leg: 'entrega', position: null, business: b, destination: d, remainingM: null, routeDistanceM: null, live: false })
    expect(saindo).toMatchObject({ stage: 'entrega', moving: true })
    const coleta = roadState({ leg: 'coleta', position: null, business: b, destination: d, remainingM: 200, routeDistanceM: 1000, live: true })
    expect(coleta.progress).toBeCloseTo(STORE_AT * 0.8, 5)
  })
})
