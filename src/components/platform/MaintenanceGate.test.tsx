import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ mode: 'normal' as string, eta: null as string | null, roles: [] as string[] }))
vi.mock('../../features/auth/AuthProvider.tsx', () => ({ useAuth: () => ({ authz: { userId: 'u', roles: h.roles, memberships: [] } }) }))
vi.mock('../../features/platform/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../../features/platform/repository.ts')>()),
  getPlatformStatus: () => Promise.resolve({ mode: h.mode, eta: h.eta }),
}))

import { MaintenanceGate } from './MaintenanceGate.tsx'

afterEach(cleanup)
const show = (path = '/') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}><MaintenanceGate><p>Conteúdo da Tucaí</p></MaintenanceGate></MemoryRouter>
  </QueryClientProvider>,
)

describe('Modo manutenção (tela)', () => {
  it('em manutenção, usuário comum vê a página pública, com previsão e sem dados técnicos', async () => {
    h.mode = 'manutencao'; h.eta = new Date(Date.now() + 3600_000).toISOString(); h.roles = ['customer']
    show()
    expect(await screen.findByRole('heading', { name: 'Estamos em manutenção!' })).toBeInTheDocument()
    expect(screen.getByText('TUCAÍ')).toBeInTheDocument()
    expect(screen.getByText('Estamos realizando melhorias para oferecer uma experiência ainda melhor.')).toBeInTheDocument()
    expect(screen.getByText('Em breve estaremos de volta.')).toBeInTheDocument()
    expect(screen.getByText(/Previsão de retorno: (hoje, às|\d{2}\/\d{2}, às)/)).toBeInTheDocument()
    expect(screen.queryByText('Conteúdo da Tucaí')).not.toBeInTheDocument()
  })
  it('Master continua navegando; /admin sempre acessível', async () => {
    h.mode = 'manutencao'; h.roles = ['platform_master']
    show()
    expect(await screen.findByText('Conteúdo da Tucaí')).toBeInTheDocument()
    cleanup(); h.roles = []
    show('/admin/configuracoes')
    expect(await screen.findByText('Conteúdo da Tucaí')).toBeInTheDocument()
  })
  it('preparando: aviso discreto e app funcionando', async () => {
    h.mode = 'preparando'; h.roles = []
    show()
    expect(await screen.findByText(/novos pedidos e alterações estão pausados/)).toBeInTheDocument()
    expect(screen.getByText('Conteúdo da Tucaí')).toBeInTheDocument()
  })
})
