import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../features/admin/repository.ts', () => ({
  getGateway: () => Promise.resolve({ mode: 'teste', publicKey: 'TEST-pk-123', tokenLast4: '5678', tokenSet: true, webhookSecretSet: false, integrationKeySet: false, enabled: true, updatedAt: null }),
  saveGateway: vi.fn(),
  generateIntegrationKey: vi.fn(),
  paymentsPage: () => Promise.resolve([{ id: 'ch1', business: 'Lanchonete F', kind: 'plano', description: 'Mensalidade Delivery', amountCents: 7900, dueOn: '2026-11-20',
    status: 'paga', paidAt: '2026-11-11T12:00:00Z', paidMethod: null, provider: 'mercadopago', providerPaymentId: '123456', createdAt: '2026-11-01T12:00:00Z',
    events: [{ action: 'finance.charge', at: '2026-11-01T12:00:00Z' }, { action: 'payments.confirmed', at: '2026-11-11T12:00:00Z' }], total: 1 }]),
}))
vi.mock('../../features/payments/repository.ts', () => ({ testGateway: vi.fn() }))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('./access-context.ts', () => ({ useAdminAccess: () => ({ isMaster: true, mfaOk: true }) }))

import { AdminPayments } from './AdminPayments.tsx'
afterEach(cleanup)

describe('Pagamentos (Mercado Pago)', () => {
  it('mostra situação sem expor o token e o passo a passo com o endereço dos avisos', async () => {
    render(<QueryClientProvider client={new QueryClient()}><AdminPayments /></QueryClientProvider>)
    expect(await screen.findByText('Ativo')).toBeInTheDocument()
    expect(screen.getByText('Ambiente de teste')).toBeInTheDocument()
    expect(screen.getByText('Access Token: •••• 5678')).toBeInTheDocument()
    expect(screen.getByLabelText(/Access Token \(secreto\)/)).toHaveValue('')
    expect(screen.getByText(/\/api\/pagamentos\/webhook$/)).toBeInTheDocument()
    expect(screen.getByText('PAYMENTS_INTEGRATION_KEY')).toBeInTheDocument()
  })
})

describe('transações', () => {
  it('lista cobrança confirmada pelo Mercado Pago com eventos', async () => {
    render(<QueryClientProvider client={new QueryClient()}><AdminPayments /></QueryClientProvider>)
    expect(await screen.findByText(/Mercado Pago \(ID 123456\)/)).toBeInTheDocument()
    expect(screen.getByText(/Cobrança gerada .* → Confirmada pelo Mercado Pago/)).toBeInTheDocument()
  })
})
