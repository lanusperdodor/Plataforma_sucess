import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ cb: null as null | ((t: 'orders' | 'notifications' | 'resync') => void), off: vi.fn(), user: 'u1' as string | null }))
vi.mock('./repository.ts', () => ({
  subscribeLiveUpdates: (_u: string, cb: (t: 'orders' | 'notifications' | 'resync') => void) => { h.cb = cb; return h.off },
}))
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
})
