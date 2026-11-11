import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ invite: vi.fn(), link: vi.fn(), result: 'convidado' as 'convidado' | 'vinculado' }))
vi.mock('../../features/admin/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../../features/admin/repository.ts')>()),
  listStaff: () => Promise.resolve([]),
  listInvites: () => Promise.resolve([]),
  inviteStaff: (...a: unknown[]) => { h.invite(...a); return Promise.resolve(h.result) },
}))
vi.mock('../../features/account/repository.ts', () => ({ sendInviteLink: (e: string) => { h.link(e); return Promise.resolve() } }))
vi.mock('../../features/auth/AuthProvider.tsx', () => ({ useAuth: () => ({ session: { user: { id: 'm' } } }) }))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { AdminTeam } from './AdminTeam.tsx'

afterEach(() => { cleanup(); h.result = 'convidado'; h.invite.mockClear(); h.link.mockClear() })
const show = () => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><AdminTeam /></MemoryRouter></QueryClientProvider>)

describe('Equipe: convites', () => {
  it('convida operador com permissões e envia o link seguro (sem senha)', async () => {
    show()
    fireEvent.change(screen.getByLabelText('E-mail da pessoa'), { target: { value: 'Nova@Exemplo.com' } })
    fireEvent.click(screen.getByLabelText('Consultar financeiro'))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar convite' }))
    await vi.waitFor(() => expect(h.link).toHaveBeenCalledWith('nova@exemplo.com'))
    expect(h.invite).toHaveBeenCalledWith('nova@exemplo.com', 'platform_operator', ['finance.view'], '')
  })
  it('conta existente é vinculada sem novo link; Master exige confirmação reforçada', async () => {
    h.result = 'vinculado'
    show()
    fireEvent.change(screen.getByLabelText('E-mail da pessoa'), { target: { value: 'ja@exemplo.com' } })
    fireEvent.change(screen.getByLabelText('Nível de acesso'), { target: { value: 'platform_master' } })
    expect(screen.getByRole('button', { name: 'Enviar convite' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/CONCEDER MASTER/), { target: { value: 'CONCEDER MASTER' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar convite' }))
    await vi.waitFor(() => expect(h.invite).toHaveBeenCalledWith('ja@exemplo.com', 'platform_master', [], 'CONCEDER MASTER'))
    expect(h.link).not.toHaveBeenCalled()
  })
})
