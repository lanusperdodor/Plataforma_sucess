import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const tracking = {
  leg: 'entrega', viewer: 'entregador', status: 'out_for_delivery', vehicle: 'moto',
  business: { name: 'Lanchonete', address: 'Av. Principal, 50', lat: -20.084, lng: -44.578 },
  destination: { lat: -20.072, lng: -44.564 },
  position: { lat: -20.078, lng: -44.571, accuracy_m: 8, heading: null, speed_kmh: null, recorded_at: new Date().toISOString(), received_at: new Date().toISOString() },
  route: { leg: 'entrega', geometry: [[-44.578, -20.084], [-44.564, -20.072]], distance_m: 2100, duration_s: 420, provider: 'openrouteservice', computed_at: new Date().toISOString() },
  server_time: new Date().toISOString(),
}
vi.mock('../../features/rastreamento/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../../features/rastreamento/repository.ts')>()),
  getTracking: () => Promise.resolve(tracking),
  subscribeTracking: () => () => undefined,
}))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { LiveLocation } from './LiveLocation.tsx'

afterEach(cleanup)

describe('entregador: rota dentro da Tucaí', () => {
  it('"Ver rota de entrega" abre o acompanhamento com a motinha; o Google Maps é só um link secundário opcional', async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LiveLocation orderId="o1" pickupAddress="Av. Principal, 50" dropoffAddress="Rua A, 1" /></QueryClientProvider>)
    const btn = await screen.findByRole('button', { name: 'Ver rota de entrega' })
    expect(btn.tagName).toBe('BUTTON') // não é link externo
    fireEvent.click(btn)
    expect(await screen.findByTestId('motinha')).toBeInTheDocument()
    expect(screen.getByText('Acompanhe a entrega')).toBeInTheDocument()
    expect(screen.getByText(/até o cliente/)).toBeInTheDocument()
    const external = screen.getByRole('link', { name: /Abrir no app Google Maps \(opcional/ })
    expect(external).toHaveAttribute('href', expect.stringContaining('google.com/maps/dir/'))
  })
})
