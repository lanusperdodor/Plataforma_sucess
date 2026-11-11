import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../features/admin/repository.ts', () => ({
  getGateway: () => Promise.resolve({ mode: 'teste', publicKey: 'TEST-pk-123', tokenLast4: '5678', tokenSet: true, webhookSecretSet: false, integrationKeySet: false, enabled: true, updatedAt: null }),
  saveGateway: vi.fn(),
  generateIntegrationKey: vi.fn(),
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
