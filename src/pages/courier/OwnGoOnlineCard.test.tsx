import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ go: vi.fn() }))
vi.mock('../../features/courier/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../../features/courier/repository.ts')>()),
  ownCourierGoOnline: (i: unknown) => { h.go(i); return Promise.resolve('approved') },
}))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
import { OwnGoOnlineCard } from './OwnGoOnlineCard.tsx'
afterEach(cleanup)
const show = (pending = false) => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><OwnGoOnlineCard pending={pending} /></MemoryRouter></QueryClientProvider>)

describe('entregador próprio já logado', () => {
  it('fica online direto, sem página de cadastro (1ª vez confirma celular e veículo)', async () => {
    show()
    expect(screen.queryByText(/faça o cadastro/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ficar online e receber entregas' }))
    fireEvent.change(screen.getByLabelText('Celular (WhatsApp)'), { target: { value: '(35) 99999-0000' } })
    fireEvent.change(screen.getByLabelText('Veículo'), { target: { value: 'bicicleta' } })
    const go = screen.getByRole('button', { name: 'Ficar online agora' })
    expect(go).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(go)
    await vi.waitFor(() => expect(h.go).toHaveBeenCalledWith({ phone: '(35) 99999-0000', vehicle: 'bicicleta', plate: undefined, cnh: undefined, acceptTerms: true }))
  })
  it('cadastro em análise: avisa em vez do botão', () => {
    show(true)
    expect(screen.queryByRole('button', { name: /Ficar online/ })).toBeNull()
    expect(screen.getByText(/em análise/)).toBeInTheDocument()
  })
})
