import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ quote: vi.fn(), place: vi.fn(), toastError: vi.fn(), saveAddr: vi.fn() }))
vi.mock('../features/cart/cartStore.ts', () => ({
  useCart: () => ({ business: { id: 'b1', slug: 'lanchonete', name: 'Lanchonete' }, lines: [{ key: 'l1', productId: 'p1', name: 'X-Tuca', unitCents: 3000, quantity: 1 }] }),
  cartSubtotal: () => 3000,
  clearCart: vi.fn(),
}))
vi.mock('../features/store/repository.ts', () => ({
  getPublicBusiness: () => Promise.resolve({ id: 'b1', name: 'Lanchonete', deliveryOffer: 'partner', acceptsPickup: true, ownDeliveryFeeCents: 0, minOrderCents: 0, addressLine: 'Av. Principal, 50' }),
}))
vi.mock('../components/map/DeliveryTracking.tsx', () => ({ currentPosition: () => Promise.resolve({ coords: { latitude: -20.08, longitude: -44.58 } }) }))
vi.mock('../features/orders/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../features/orders/repository.ts')>()),
  requestFreightQuote: (...a: unknown[]) => h.quote(...a),
  placeOrder: (...a: unknown[]) => h.place(...a),
}))
vi.mock('../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: h.toastError }) }))
vi.mock('../features/tracking/tracker.ts', () => ({ trackBeginCheckout: vi.fn() }))
vi.mock('../features/auth/AuthProvider.tsx', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } } }) }))
vi.mock('../features/address/repository.ts', () => ({
  getMyAddress: () => Promise.resolve({ cep: '37975000', street: 'Rua das Flores', number: '120', complement: '', district: 'Centro', city: 'Itaú de Minas', uf: 'MG' }),
  saveMyAddress: (...a: unknown[]) => { h.saveAddr(...a); return Promise.resolve() },
}))

import { CheckoutPage } from './CheckoutPage.tsx'

afterEach(() => { cleanup(); h.quote.mockReset(); h.place.mockReset(); h.toastError.mockReset(); h.saveAddr.mockReset() })
const renderIt = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><CheckoutPage /></MemoryRouter></QueryClientProvider>)

describe('checkout: frete por distância', () => {
  it('calcula pelo GPS e mostra o frete antes de confirmar (2,4 km → R$ 5)', async () => {
    h.quote.mockResolvedValue({ quoteId: 'q1', outOfArea: false, distanceM: 2412, customerCents: 500, band: 2, freeDelivery: false })
    renderIt()
    fireEvent.click(await screen.findByRole('radio', { name: /parceiro/i }))
    expect(screen.getByText(/Sem o cálculo, vale o frete da menor faixa/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Calcular frete pelo meu local' }))
    expect(await screen.findByText(/2,4 km pelas ruas/)).toBeInTheDocument()
    expect(h.quote).toHaveBeenCalledWith('b1', -20.08, -44.58)
    expect(screen.getByText('R$ 35,00')).toBeInTheDocument() // total 30 + 5
  })

  it('acima do limite: avisa e não envia o pedido', async () => {
    h.quote.mockResolvedValue({ quoteId: 'q2', outOfArea: true, distanceM: 7300, customerCents: null, band: null, freeDelivery: false })
    renderIt()
    fireEvent.click(await screen.findByRole('radio', { name: /parceiro/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Calcular frete pelo meu local' }))
    expect(await screen.findByText(/7,3 km da loja, acima do limite/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Cliente 1' } })
    fireEvent.change(screen.getByLabelText('Telefone / WhatsApp'), { target: { value: '(35) 99999-0001' } })
    expect(await screen.findByDisplayValue('Rua das Flores')).toBeInTheDocument() // endereço salvo no perfil
    fireEvent.submit(screen.getByRole('button', { name: /Enviar pedido|Fazer pedido|Confirmar/i }).closest('form')!)
    expect(h.place).not.toHaveBeenCalled()
    expect(h.toastError).toHaveBeenCalledWith(expect.stringMatching(/fora da área/))
  })

  it('endereço em campos separados: monta o texto do pedido e salva no perfil', async () => {
    h.place.mockResolvedValue('o1')
    renderIt()
    fireEvent.click(await screen.findByRole('radio', { name: /parceiro/i }))
    expect(await screen.findByDisplayValue('Rua das Flores')).toBeInTheDocument()
    expect(screen.getByLabelText('CEP')).toHaveValue('37975-000')
    expect(screen.getByLabelText('Cidade')).toHaveValue('Itaú de Minas')
    fireEvent.change(screen.getByLabelText('Número'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Cliente 1' } })
    fireEvent.change(screen.getByLabelText('Telefone / WhatsApp'), { target: { value: '(35) 99999-0001' } })
    const form = screen.getByRole('button', { name: /Enviar pedido|Fazer pedido|Confirmar/i }).closest('form')!
    fireEvent.submit(form)
    expect(await screen.findByText(/Digite o número/)).toBeInTheDocument()
    expect(h.place).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Número'), { target: { value: '45' } })
    fireEvent.change(screen.getByLabelText(/Complemento/), { target: { value: 'Casa 2' } })
    fireEvent.submit(form)
    await vi.waitFor(() => expect(h.place).toHaveBeenCalled())
    expect(h.place.mock.calls[0]![1]).toMatchObject({ address: 'Rua das Flores, 45, Casa 2 - Centro - Itaú de Minas/MG, CEP 37975-000' })
    await vi.waitFor(() => expect(h.saveAddr).toHaveBeenCalledWith('u1', expect.objectContaining({ number: '45' })))
  })
})
