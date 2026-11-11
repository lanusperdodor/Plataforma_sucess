import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ audit: vi.fn(), couriers: vi.fn(), businesses: vi.fn(), review: vi.fn() }))
const auditRows = (page: number) =>
  Array.from({ length: page === 3 ? 5 : 20 }, (_, i) => ({ id: page * 100 + i, actorEmail: 'm@x.com', actorName: 'Master', action: 'accounts.block', entity: 'auth.users', entityId: String((page - 1) * 20 + i + 1), details: {}, createdAt: '2026-11-11T12:00:00Z', total: 45 }))
vi.mock('../../features/admin/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../../features/admin/repository.ts')>()),
  auditPage: (page: number, f: unknown) => { h.audit(page, f); return Promise.resolve(auditRows(page)) },
  auditActions: () => Promise.resolve(['accounts.block']),
  couriersPage: (status: string, search: string, page: number) => {
    h.couriers(status, search, page)
    return Promise.resolve([{ userId: 'k1', email: 'entregador-abc@teste.example.com', fullName: 'Entregador Teste', phone: '35999990003', city: 'Itaú de Minas - MG',
      vehicle: 'moto', plate: 'TST1A23', cnh: 'A', status: 'approved', isOnline: false, reviewNote: null, submittedAt: '2026-11-11T12:00:00Z', reviewedAt: null,
      deliveriesDone: 3, deliveriesActive: 0, lastDeliveryAt: null, isTest: true, total: 1 }])
  },
  courierHistory: () => Promise.resolve([]),
  businessesPage: (f: unknown, page: number) => {
    h.businesses(f, page)
    return Promise.resolve([{ id: 'b1', name: '[Teste] Mercadinho Teste · lote abc123', slug: 'teste-mercadinho', status: 'pending', type: 'loja', cityId: 'c1', city: 'Itaú de Minas', state: 'MG',
      categoryId: null, category: 'Mercados', ownerEmail: 'lojista@x.com', ownerName: 'Lojista', phone: null, description: null, address: null, logoUrl: null, coverUrl: null,
      submittedAt: null, reviewedAt: null, reviewNote: null, createdAt: '2026-11-11T12:00:00Z', isTest: true, total: 1 }])
  },
  listCities: () => Promise.resolve([{ id: 'c1', name: 'Itaú de Minas', state: 'MG', slug: 'x', centerLat: null, centerLng: null, isActive: true }]),
  reviewBusiness: (id: string, d: string) => { h.review(id, d); return Promise.resolve('active') },
}))
vi.mock('../../features/catalog/repository.ts', () => ({ listCategories: () => Promise.resolve([]) }))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { AdminAudit } from './AdminAudit.tsx'
import { AdminBusinesses } from './AdminBusinesses.tsx'
import { AdminCouriers } from './AdminCouriers.tsx'

afterEach(cleanup)
const show = (el: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{el}</MemoryRouter></QueryClientProvider>)

describe('Auditoria', () => {
  it('20 por página, com Anterior/Próxima, página atual e total', async () => {
    show(<AdminAudit />)
    expect(await screen.findByText('Página 1 de 3 · 1–20 de 45')).toBeInTheDocument()
    expect(screen.getAllByText('Conta bloqueada', { selector: 'span' })).toHaveLength(20)
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))
    expect(await screen.findByText('Página 2 de 3 · 21–40 de 45')).toBeInTheDocument()
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Próxima' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))
    expect(await screen.findByText('Página 3 de 3 · 41–45 de 45')).toBeInTheDocument()
    await vi.waitFor(() => expect(screen.getAllByText('Conta bloqueada', { selector: 'span' })).toHaveLength(5))
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled()
  })
  it('filtros voltam para a página 1', async () => {
    show(<AdminAudit />)
    await screen.findByText(/Página 1/)
    fireEvent.change(screen.getByLabelText(/Usuário/), { target: { value: 'master' } })
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar' }))
    await vi.waitFor(() => expect(h.audit).toHaveBeenLastCalledWith(1, { action: '', actor: 'master', from: '', to: '' }))
  })
})

describe('Entregadores', () => {
  it('abre em "Todos" e mostra entregadores aprovados de teste com entregas reais', async () => {
    show(<AdminCouriers />)
    expect(await screen.findByText('Entregador Teste')).toBeInTheDocument()
    expect(h.couriers).toHaveBeenCalledWith('todos', '', 1)
    expect(screen.getByText('Aprovado')).toBeInTheDocument()
    expect(screen.getByText('Offline')).toBeInTheDocument()
    expect(screen.getByText(/Entregas concluídas:/)).toHaveTextContent('3')
  })
})

describe('Estabelecimentos em cards', () => {
  it('card com cidade, tipo e status; detalhes com ações', async () => {
    show(<AdminBusinesses />)
    expect(await screen.findByRole('heading', { name: /Mercadinho Teste/ })).toBeInTheDocument()
    expect(screen.getByText('Itaú de Minas - MG', { selector: 'p' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar' }))
    await vi.waitFor(() => expect(h.review).toHaveBeenCalledWith('b1', 'approve'))
  })
})
