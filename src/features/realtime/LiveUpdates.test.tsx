import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

type N = { id: string; kind: string; message: string | null; link: string | null }
const h = vi.hoisted(() => ({ cb: null as null | ((t: 'orders' | 'notifications' | 'deliveries' | 'resync', n?: N) => void), off: vi.fn(), user: 'u1' as string | null, toast: vi.fn() }))
vi.mock('./repository.ts', () => ({
  subscribeLiveUpdates: (_u: string, cb: (t: 'orders' | 'notifications' | 'deliveries' | 'resync', n?: N) => void) => { h.cb = cb; return h.off },
}))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: h.toast, error: vi.fn() }) }))
vi.mock('../auth/AuthProvider.tsx', () => ({ useAuth: () => ({ session: h.user ? { user: { id: h.user } } : null }) }))

import { LiveUpdates } from './LiveUpdates.tsx'

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Atualizações em tempo real', () => {
  it('pedido alterado atualiza os painéis de todos os perfis (agrupando eventos)', () => {
    vi.useFakeTimers()
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const view = render(<QueryClientProvider client={qc}><LiveUpdates /></QueryClientProvider>)
    act(() => { h.cb?.('orders'); h.cb?.('orders') })
    expect(spy).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(400) })
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    expect(keys).toEqual(expect.arrayContaining(['["orders"]', '["merchant","orders"]', '["courier"]', '["admin","orders"]']))
    expect(keys.filter((k) => k === '["orders"]')).toHaveLength(1)
    view.unmount()
    expect(h.off).toHaveBeenCalled()
  })

  it('reconexão recarrega o estado', () => {
    vi.useFakeTimers()
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    render(<QueryClientProvider client={qc}><LiveUpdates /></QueryClientProvider>)
    act(() => { h.cb?.('resync'); vi.advanceTimersByTime(400) })
    expect(spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toEqual(expect.arrayContaining(['["merchant"]', '["me","notifications"]']))
  })

  it('notificação nova vira alerta na tela uma única vez (eventos repetidos ignorados)', () => {
    vi.useFakeTimers()
    render(<QueryClientProvider client={new QueryClient()}><LiveUpdates /></QueryClientProvider>)
    const n = { id: 'n1', kind: 'order_new', message: 'Novo pedido #ABC123.', link: '/painel/b/pedidos' }
    act(() => { h.cb?.('notifications', n); h.cb?.('notifications', n) })
    expect(h.toast).toHaveBeenCalledTimes(1)
    expect(h.toast).toHaveBeenCalledWith('Novo pedido #ABC123.')
  })
})
