import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn() }))
vi.mock('../features/conecta/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../features/conecta/repository.ts')>()),
  listNotifications: h.list,
  markAllRead: h.read,
}))
vi.mock('../features/auth/AuthProvider.tsx', () => ({ useAuth: () => ({ session: { user: { id: 'cliente1' } } }) }))

import { RepositoryError } from '../lib/errors.ts'
import { NotificationsPage } from './NotificationsPage.tsx'

afterEach(() => { cleanup(); h.list.mockReset(); h.read.mockReset() })
const renderIt = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><NotificationsPage /></MemoryRouter></QueryClientProvider>)

describe('página de notificações', () => {
  it('erro mostra a mensagem e "Tentar novamente" consulta de novo de verdade', async () => {
    h.list.mockRejectedValueOnce(new RepositoryError('unavailable', 'Serviço indisponível.'))
    h.list.mockResolvedValueOnce([{ id: 'n1', kind: 'order_update', actor: null, postId: null, link: '/pedidos/p1', message: 'Seu pedido #A7K2 saiu para entrega.', read: true, createdAt: new Date().toISOString() }])
    renderIt()
    fireEvent.click(await screen.findByRole('button', { name: /Tentar novamente/ }))
    expect(await screen.findByText('Seu pedido #A7K2 saiu para entrega.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /saiu para entrega/ })).toHaveAttribute('href', '/pedidos/p1')
    expect(h.list).toHaveBeenCalledTimes(2)
    expect(h.list).toHaveBeenCalledWith('cliente1')
  })

  it('lista vazia de verdade e marcação como lidas ao abrir', async () => {
    h.list.mockResolvedValueOnce([])
    renderIt()
    expect(await screen.findByText('Nenhuma notificação')).toBeInTheDocument()
    expect(h.read).not.toHaveBeenCalled()
    cleanup()
    h.list.mockResolvedValueOnce([{ id: 'n2', kind: 'friend_request', actor: null, postId: null, link: '/conectuai/amigos', message: null, read: false, createdAt: new Date().toISOString() }])
    h.read.mockResolvedValueOnce(undefined)
    renderIt()
    expect(await screen.findByText('Alguém quer ser seu amigo.')).toBeInTheDocument()
    await vi.waitFor(() => expect(h.read).toHaveBeenCalledWith('cliente1'))
  })
})
