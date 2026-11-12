import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ purge: vi.fn(), toast: vi.fn(), std: vi.fn(), padrao: true }))
vi.mock('../../features/admin/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../../features/admin/repository.ts')>()),
  listTestData: () => Promise.resolve([{ runId: 'r1', city: 'Itaú de Minas - MG', createdAt: '2026-11-12T12:00:00Z', businesses: 3, logins: [{ label: 'Lojista', email: 'lojista-x@teste.example.com' }] }]),
  listCities: () => Promise.resolve([{ id: 'c1', name: 'Itaú de Minas', state: 'MG', isActive: true }]),
  getTestAccountsStatus: () => Promise.resolve(h.padrao
    ? { contas: 7, lotes: 1, padrao: true, cidade: 'Itaú de Minas - MG', faltando: [], excedentes: [], bloqueios: [] }
    : { contas: 9, lotes: 2, padrao: false, cidade: 'Itaú de Minas - MG', faltando: [], excedentes: [{ label: 'Cozinha', email: 'cozinha-old@teste.example.com' }, { label: 'Operador', email: 'operador-old@teste.example.com' }], bloqueios: [] }),
  standardizeTestAccounts: (c: string, w: string) => { h.std(c, w); return Promise.resolve({ removedRuns: 1, removedAccounts: 2, created: { runId: 'r', city: 'Itaú', reused: true, password: null, logins: [] } }) },
  removeAllTestData: (w: string) => { h.purge(w); return Promise.resolve({ lotes: 1, pedidos: 2, estabelecimentos: 3, logins: 10 }) },
}))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: h.toast, error: vi.fn() }) }))

import { TestDataSection } from './TestData.tsx'

afterEach(cleanup)

describe('Logins → padrão de 7 contas de teste', () => {
  it('mostra quando está no padrão', async () => {
    h.padrao = true
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TestDataSection /></QueryClientProvider>)
    expect(await screen.findByText('Padrão em dia: exatamente 7 contas de teste em Itaú de Minas - MG.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Padronizar as 7 contas' })).not.toBeInTheDocument()
  })
  it('lista excedentes e padroniza com confirmação e cidade', async () => {
    h.padrao = false
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TestDataSection /></QueryClientProvider>)
    expect(await screen.findByText(/9 conta\(s\) de teste ativa\(s\) — o padrão é exatamente 7/)).toBeInTheDocument()
    expect(screen.getByText('cozinha-old@teste.example.com')).toBeInTheDocument()
    const city = screen.getByRole('combobox', { name: 'Cidade' })
    fireEvent.focus(city)
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Itaú de Minas - MG/ }))
    const go = screen.getByRole('button', { name: 'Padronizar as 7 contas' })
    expect(go).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/PADRONIZAR/), { target: { value: 'padronizar' } })
    fireEvent.click(go)
    await vi.waitFor(() => expect(h.std).toHaveBeenCalledWith('c1', 'padronizar'))
  })
})

describe('Logins → Excluir todos os dados de teste', () => {
  it('pede a palavra EXCLUIR e mostra o que foi apagado', async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TestDataSection /></QueryClientProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir todos os dados de teste' }))
    const go = screen.getByRole('button', { name: 'Excluir tudo' })
    expect(go).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/EXCLUIR/), { target: { value: 'excluir' } })
    expect(go).toBeEnabled()
    fireEvent.click(go)
    await vi.waitFor(() => expect(h.purge).toHaveBeenCalledWith('excluir'))
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith('Dados de teste excluídos: 1 lote(s), 3 estabelecimento(s), 2 pedido(s), 10 login(s).'))
  })
})
