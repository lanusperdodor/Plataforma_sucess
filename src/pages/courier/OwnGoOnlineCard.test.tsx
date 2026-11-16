import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ go: vi.fn() }))
vi.mock('../../features/courier/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../../features/courier/repository.ts')>()),
  ownCourierGoOnline: () => { h.go(); return Promise.resolve('approved') },
}))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
import { OwnGoOnlineCard } from './OwnGoOnlineCard.tsx'
afterEach(cleanup)
const show = (pending = false) => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><OwnGoOnlineCard pending={pending} /></MemoryRouter></QueryClientProvider>)

describe('entregador próprio já logado', () => {
  it('fica online com um clique, sem digitar nada', async () => {
    show()
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ficar online e receber entregas' }))
    await vi.waitFor(() => expect(h.go).toHaveBeenCalledTimes(1))
  })
  it('cadastro em análise: avisa em vez do botão', () => {
    show(true)
    expect(screen.queryByRole('button', { name: /Ficar online/ })).toBeNull()
    expect(screen.getByText(/em análise/)).toBeInTheDocument()
  })
})
