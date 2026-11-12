import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ status: vi.fn(), suggest: vi.fn(), lastQuery: {} as Record<string, unknown> }))
const region = (o: Record<string, unknown>) => ({ id: 'r1', name: 'Região de Itaú de Minas', slug: 'x', kind: 'raio', status: 'rascunho', uf: 'MG', center_ibge: 3133758, center_name: 'Itaú de Minas',
  center_lat: -20.7, center_lng: -46.7, radius_km: 100, suggested: false, municipalities: 58, primary_municipalities: 40, businesses: 3, active_campaigns: 0, in_use: false, total_count: 2, ...o })
vi.mock('../../features/regions/repository.ts', async (orig) => ({
  ...(await orig<typeof import('../../features/regions/repository.ts')>()),
  getCoverageSummary: () => Promise.resolve({ municipios: 5571, com_regiao_principal: 5571, em_raio: 5571, em_regiao_ativa: 58, lacunas: 0, sem_coordenadas: 0, regioes: { rascunho: 6 },
    cidades_atendidas: 58, cidades_com_ibge: 58, cidades_operacionais: 1, por_uf: [{ sigla: 'MG', nome: 'Minas Gerais', municipios: 853, em_raio: 853, lacunas: 0, lat: -18.5, lng: -44.6 }] }),
  getRegionMap: () => Promise.resolve([{ id: 'r1', name: 'Região de Itaú de Minas', status: 'ativa', lat: -20.7, lng: -46.7, radius_km: 100 }]),
  listRegions: (q: Record<string, unknown>) => { h.lastQuery = q; return Promise.resolve([region({}), region({ id: 'r2', name: 'Região de Franca', status: 'ativa', in_use: true, active_campaigns: 1 })]) },
  setRegionStatus: (...a: unknown[]) => { h.status(...a); return Promise.resolve() },
  suggestRegions: (...a: unknown[]) => { h.suggest(...a); return Promise.resolve([{ seq: 1, center_ibge: 1302603, center_name: 'Manaus', uf: 'AM', newly_covered: 12, region_id: null }]) },
}))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { AdminRegions } from './AdminRegions.tsx'

afterEach(cleanup)
const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><AdminRegions /></MemoryRouter></QueryClientProvider>)

describe('Administração → Regiões', () => {
  it('separa cobertura cadastrada, regiões ativas e cidades operando; mapa e cards', async () => {
    show()
    expect(await screen.findByText('Municípios cadastrados (IBGE)')).toBeInTheDocument()
    expect(screen.getByText('Municípios cadastrados (IBGE)').nextSibling).toHaveTextContent('5.571')
    expect(screen.getByText('Cidades com loja operando')).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: /1 regiões comerciais/ })).toBeInTheDocument()
    expect(await screen.findByText('Região de Itaú de Minas')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Ativar' })[0]!)
    await vi.waitFor(() => expect(h.status).toHaveBeenCalledWith('r1', 'ativa'))
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeDisabled() // campanha paga em andamento
  })
  it('filtro e busca sem acento vão para o servidor (paginado)', async () => {
    show()
    fireEvent.change(await screen.findByLabelText('Região ou cidade'), { target: { value: 'itau' } })
    await vi.waitFor(() => expect(h.lastQuery).toMatchObject({ q: 'itau', page: 1, pageSize: 12 }))
  })
  it('gerador prevê novos centros sem criar nada', async () => {
    show()
    fireEvent.click(await screen.findByRole('tab', { name: 'Gerador' }))
    fireEvent.click(screen.getByRole('button', { name: /Prever/ }))
    expect(await screen.findByText(/Manaus\/AM/)).toBeInTheDocument()
    expect(h.suggest).toHaveBeenCalledWith(100, 20, '', false)
  })
})
