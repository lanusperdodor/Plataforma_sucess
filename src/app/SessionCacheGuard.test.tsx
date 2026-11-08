import { cleanup, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ session: null as null | { user: { id: string } } }))
vi.mock('../features/auth/AuthProvider.tsx', () => ({ useAuth: () => ({ session: auth.session }) }))

import { SessionCacheGuard } from './SessionCacheGuard.tsx'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function setup(userId: string | null) {
  const qc = new QueryClient()
  qc.setQueryData(['me', 'a', 'orders'], [1])
  qc.setQueryData(['catalog'], [2])
  localStorage.setItem('cart:v1', 'sacola')
  auth.session = userId ? { user: { id: userId } } : null
  const ui = () => (
    <QueryClientProvider client={qc}>
      <SessionCacheGuard />
    </QueryClientProvider>
  )
  const view = render(ui())
  return {
    qc,
    change(next: string | null) {
      auth.session = next ? { user: { id: next } } : null
      view.rerender(ui())
    },
  }
}

describe('SessionCacheGuard', () => {
  it('limpa ["me"] ao sair, preservando catálogo e Sacola', () => {
    const t = setup('a')
    expect(t.qc.getQueryData(['me', 'a', 'orders'])).toEqual([1])
    t.change(null)
    expect(t.qc.getQueryData(['me', 'a', 'orders'])).toBeUndefined()
    expect(t.qc.getQueryData(['catalog'])).toEqual([2])
    expect(localStorage.getItem('cart:v1')).toBe('sacola')
  })

  it('limpa ["me"] ao trocar de usuário', () => {
    const t = setup('a')
    t.change('b')
    expect(t.qc.getQueryData(['me', 'a', 'orders'])).toBeUndefined()
  })

  it('não limpa no login inicial nem enquanto o usuário é o mesmo', () => {
    const t = setup(null)
    t.change('a')
    expect(t.qc.getQueryData(['me', 'a', 'orders'])).toEqual([1])
    t.change('a')
    expect(t.qc.getQueryData(['me', 'a', 'orders'])).toEqual([1])
  })
})
