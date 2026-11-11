import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/feedback/Toast.tsx'
import type { Post } from '../../features/conecta/repository.ts'

const h = vi.hoisted(() => ({ me: 'u1' as string | null }))
vi.mock('../../features/auth/AuthProvider.tsx', () => ({ useAuth: () => ({ session: h.me ? { user: { id: h.me } } : null }) }))

import { PostCard, relative } from './components.tsx'

const base: Post = {
  id: 'p1', authorId: 'u1', author: { userId: 'u1', handle: 'ana', displayName: 'Ana', bio: null, avatarUrl: null, cityId: null, isPublic: true, createdAt: '' },
  business: null, product: null, shared: null, sharedUnavailable: false, body: 'Texto', isSponsored: false, hidden: false,
  likeCount: 0, commentCount: 0, createdAt: new Date().toISOString(), editedAt: null, likedByMe: false, savedByMe: false,
}
const view = (p: Post) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider><MemoryRouter><PostCard post={p} /></MemoryRouter></ToastProvider>
    </QueryClientProvider>,
  )
afterEach(cleanup)

describe('PostCard', () => {
  it('autor vê editar/excluir; ninguém vê selo de patrocínio sem a marca da plataforma', () => {
    h.me = 'u1'
    view(base)
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    expect(screen.getByRole('button', { name: /Editar/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Excluir/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Denunciar/ })).toBeNull()
    expect(screen.queryByText('Patrocinado')).toBeNull()
  })
  it('outra pessoa vê denunciar/bloquear, não editar', () => {
    h.me = 'u2'
    view({ ...base, isSponsored: true })
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    expect(screen.getByRole('button', { name: /Denunciar/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Bloquear perfil/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Editar/ })).toBeNull()
    expect(screen.getByText('Patrocinado')).toBeInTheDocument()
  })
  it('conteúdo ocultado: aviso e contestação para o autor; curtir desativado', () => {
    h.me = 'u1'
    view({ ...base, hidden: true })
    expect(screen.getByText(/Ocultada pela moderação/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Contestar decisão' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Curtir/ })).toBeDisabled()
  })
  it('visitante não vê menu e o texto malicioso é exibido literalmente', () => {
    h.me = null
    const { container } = view({ ...base, body: '<img src=x onerror=alert(1)>' })
    expect(screen.queryByRole('button', { name: 'Mais opções' })).toBeNull()
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(container.querySelector('img[onerror]')).toBeNull()
  })
  it('tempo relativo em português', () => {
    const now = Date.parse('2026-11-11T12:00:00Z')
    expect(relative('2026-11-11T11:59:30Z', now)).toBe('agora')
    expect(relative('2026-11-11T11:00:00Z', now)).toBe('há 1 hora')
  })
})
