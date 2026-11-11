import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ created: vi.fn() }))
vi.mock('../../features/admin/repository.ts', () => ({
  listCities: () => Promise.resolve([{ id: 'c1', name: 'Itaú de Minas', state: 'MG', slug: 'x', centerLat: null, centerLng: null, isActive: true }]),
  listTestData: () => Promise.resolve([]),
  createTestData: (id: string) => {
    h.created(id)
    return Promise.resolve({ runId: 'r1', city: 'Itaú de Minas - MG', password: 'Teste-ABCDEF12!', logins: [{ role: 'cliente', label: 'Cliente 1', email: 'cliente1-x@teste.example.com' }] })
  },
  removeTestData: () => Promise.resolve(),
}))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { AdminSettings } from './AdminSettings.tsx'

afterEach(cleanup)

describe('Configurações do Master', () => {
  it('escolhe a cidade, cria os dados de teste e mostra logins e senha uma vez', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><AdminSettings /></MemoryRouter>
      </QueryClientProvider>,
    )
    const button = screen.getByRole('button', { name: /Criar dados de teste/ })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Cidade'), { target: { value: (await screen.findByRole('option', { name: 'Itaú de Minas - MG' })).getAttribute('value') } })
    fireEvent.click(button)
    expect(await screen.findByText('Teste-ABCDEF12!')).toBeInTheDocument()
    expect(screen.getByText('cliente1-x@teste.example.com')).toBeInTheDocument()
    expect(h.created).toHaveBeenCalledWith('c1')
  })
})
