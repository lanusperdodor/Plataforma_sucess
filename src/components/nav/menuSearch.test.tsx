import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Bell, Receipt, Settings, Wallet } from 'lucide-react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { matches, normalize } from './menuSearch.tsx'
import { PanelSidebar } from '../panel/PanelNav.tsx'

afterEach(cleanup)

describe('busca no menu', () => {
  it('ignora acentos e maiúsculas e aceita várias palavras', () => {
    expect(normalize('Notificações')).toBe('notificacoes')
    expect(matches('notificacoes', 'Notificações')).toBe(true)
    expect(matches('SAQ', 'Saques')).toBe(true)
    expect(matches('frete dist', 'Frete por distância')).toBe(true)
    expect(matches('pedidos', 'Saques')).toBe(false)
    expect(matches('', 'Qualquer')).toBe(true)
  })
  it('menu dos painéis: filtra as abas, avisa quando não acha e Enter abre a primeira', () => {
    const groups = [
      { id: 'op', label: 'Operação', items: [{ to: '/admin/pedidos', label: 'Pedidos', icon: Receipt }, { to: '/admin/avisos', label: 'Notificações', icon: Bell }] },
      { id: 'fin', label: 'Financeiro', items: [{ to: '/admin/saques', label: 'Saques dos entregadores', icon: Wallet }, { to: '/admin/config', label: 'Configurações', icon: Settings }] },
    ]
    render(<MemoryRouter initialEntries={['/admin']}><Routes><Route path="*" element={<><PanelSidebar groups={groups} scope="teste" label="Menu do teste" /><p data-testid="rota" /></>} /></Routes></MemoryRouter>)
    const input = screen.getByLabelText('Buscar no menu')
    fireEvent.change(input, { target: { value: 'saque' } })
    expect(screen.getByRole('link', { name: /Saques dos entregadores/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Pedidos/ })).toBeNull()
    fireEvent.change(input, { target: { value: 'financeiro' } })
    expect(screen.getAllByRole('link')).toHaveLength(2) // busca pelo nome do grupo
    fireEvent.change(input, { target: { value: 'xyz' } })
    expect(screen.getByText('Nenhuma aba encontrada.')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'notific' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect((screen.getByLabelText('Buscar no menu') as HTMLInputElement).value).toBe('')
  })
})
