import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ set: vi.fn(), mode: 'normal' as string, mfa: true }))
vi.mock('../../features/platform/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../../features/platform/repository.ts')>()),
  getMaintenanceStatus: () => Promise.resolve({ mode: h.mode, reason: h.mode === 'normal' ? null : 'Atualização', eta: null, changed_at: null, changed_by: 'Master', prepared_at: null, started_at: null,
    em_andamento: { pedidos_abertos: 3, entregas_em_rota: 1 }, integridade: { pedido_em_rota_sem_coleta: 0 }, mfa: h.mfa }),
  setMaintenance: (...a: unknown[]) => { h.set(...a); return Promise.resolve({ mode: 'preparando', em_andamento: {}, integridade: {} }) },
}))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { MaintenanceSection } from './AdminMaintenance.tsx'

afterEach(cleanup)
const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><MaintenanceSection /></MemoryRouter></QueryClientProvider>)

describe('Configurações → Modo manutenção', () => {
  it('ATIVAR MANUTENÇÃO pede motivo e confirmação digitada; mostra operações em andamento', async () => {
    h.mode = 'normal'
    show()
    expect(await screen.findByText('Pedidos em andamento')).toBeInTheDocument()
    expect(screen.getByText('NORMAL')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ATIVAR MANUTENÇÃO' }))
    const ok = screen.getByRole('button', { name: 'Confirmar' })
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'Atualização do banco' } })
    expect(ok).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/para confirmar/), { target: { value: 'manutencao' } })
    expect(ok).toBeEnabled()
    fireEvent.click(ok)
    await vi.waitFor(() => expect(h.set).toHaveBeenCalledWith('preparando', 'Atualização do banco', null, 'manutencao'))
  })
  it('em preparação oferece bloqueio total ou voltar; sem MFA avisa', async () => {
    h.mode = 'preparando'; h.mfa = false
    show()
    expect(await screen.findByRole('button', { name: 'Iniciar bloqueio total' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar e voltar ao normal' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('verificação em duas etapas')
  })
})
