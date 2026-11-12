import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ purge: vi.fn(), toast: vi.fn() }))
vi.mock('../../features/admin/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../../features/admin/repository.ts')>()),
  listCities: () => Promise.resolve([]),
  listTestData: () => Promise.resolve([{ runId: 'r1', city: 'Itaú de Minas - MG', createdAt: '2026-11-12T12:00:00Z', businesses: 3, logins: [{ label: 'Lojista', email: 'lojista-x@teste.example.com' }] }]),
  removeAllTestData: (w: string) => { h.purge(w); return Promise.resolve({ lotes: 1, pedidos: 2, estabelecimentos: 3, logins: 10 }) },
}))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: h.toast, error: vi.fn() }) }))

import { TestDataSection } from './TestData.tsx'

afterEach(cleanup)

describe('Logins → Excluir todos os dados de teste', () => {
  it('pede a palavra EXCLUIR e mostra o que foi apagado', async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TestDataSection /></QueryClientProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir todos os dados de teste' }))
    const go = screen.getByRole('button', { name: 'Excluir tudo' })
    expect(go).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/para confirmar/), { target: { value: 'excluir' } })
    expect(go).toBeEnabled()
    fireEvent.click(go)
    await vi.waitFor(() => expect(h.purge).toHaveBeenCalledWith('excluir'))
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith('Dados de teste excluídos: 1 lote(s), 3 estabelecimento(s), 2 pedido(s), 10 login(s).'))
  })
})
