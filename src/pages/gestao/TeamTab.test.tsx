import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ invite: vi.fn(), save: vi.fn(), exists: true }))
vi.mock('../../features/gestao/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../../features/gestao/repository.ts')>()),
  listTeam: () => Promise.resolve([{ userId: 'u0', name: 'Dono', email: 'dono@x.com', role: 'owner', pending: false, inviteId: null, createdAt: '', username: 'dono', functionId: null, functionName: null }]),
  listMemberExtras: () => Promise.resolve([]),
  listFunctions: () => Promise.resolve([{ id: 'f1', name: 'Caixa', baseRole: 'attendant', extras: ['cash.manage'] }]),
  usernameExists: () => Promise.resolve(h.exists),
  inviteByUsername: (...a: unknown[]) => { h.invite(...a); return Promise.resolve('vinculado') },
  saveFunction: (...a: unknown[]) => { h.save(...a); return Promise.resolve('f2') },
}))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('./context.ts', () => ({ useGestao: () => ({ business: { id: 'b1', name: 'Loja' }, premium: true, can: () => true }) }))

import { TeamTab } from './TeamTab.tsx'

afterEach(() => { cleanup(); h.invite.mockReset(); h.save.mockReset() })
const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TeamTab /></QueryClientProvider>)

describe('equipe: funções e convite por nome de usuário', () => {
  it('nome de usuário inexistente avisa e bloqueia; existente adiciona com a função escolhida', async () => {
    h.exists = false
    show()
    const input = await screen.findByLabelText('Nome de usuário da pessoa')
    fireEvent.change(input, { target: { value: '@nao.existe' } })
    fireEvent.blur(input)
    expect(await screen.findByText(/Nome de usuário não encontrado/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Adicionar/ })).toBeDisabled()
    h.exists = true
    fireEvent.change(input, { target: { value: '@joao.caixa' } })
    fireEvent.blur(input)
    expect(await screen.findByText('Usuário encontrado.')).toBeInTheDocument()
    fireEvent.change(await screen.findByLabelText('Função da pessoa'), { target: { value: 'fn:f1' } })
    fireEvent.click(screen.getByRole('button', { name: /Adicionar/ }))
    await vi.waitFor(() => expect(h.invite).toHaveBeenCalledWith('b1', '@joao.caixa', null, 'f1'))
  })
  it('cria uma função com nome, cargo base e permissões', async () => {
    show()
    expect((await screen.findAllByText('Caixa')).length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Nome da função'), { target: { value: 'Balconista' } })
    fireEvent.click(screen.getByLabelText('Comandas e mesas'))
    fireEvent.click(screen.getByRole('button', { name: 'Criar função' }))
    await vi.waitFor(() => expect(h.save).toHaveBeenCalledWith('b1', { id: null, name: 'Balconista', baseRole: 'attendant', extras: ['tabs.manage'] }))
  })
})
