import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../../features/auth/AuthProvider.tsx', () => ({ useAuth: () => ({ session: null, authz: null }) }))

import { BottomNav } from './BottomNav.tsx'
import { CartFab } from './CartFab.tsx'
import { SideNav } from './SideNav.tsx'

describe('BottomNav', () => {
  it('renderiza 5 destinos e marca só o ativo com aria-current', () => {
    render(
      <MemoryRouter initialEntries={['/restaurantes/abc']}>
        <BottomNav />
      </MemoryRouter>,
    )
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(nav.querySelectorAll('a')).toHaveLength(5)
    const current = nav.querySelectorAll('[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(current[0]?.textContent).toBe('Explorar')
  })

  it('chama onPrefetch em hover e foco', () => {
    const onPrefetch = vi.fn()
    render(
      <MemoryRouter>
        <BottomNav onPrefetch={onPrefetch} />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: /Pedidos/ })
    fireEvent.focus(link)
    expect(onPrefetch).toHaveBeenCalledWith('/pedidos')
  })
})

describe('SideNav', () => {
  it('expanded mostra seção Descobrir', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <SideNav mode="expanded" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('navigation', { name: 'Menu lateral' })).toBeTruthy()
    expect(screen.getByText('Descobrir')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Lojas' })).toBeTruthy()
  })

  it('rail usa aria-label nos ícones e expande a gaveta', () => {
    render(
      <MemoryRouter initialEntries={['/pedidos']}>
        <SideNav mode="rail" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Pedidos' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: 'Expandir menu' }))
    expect(screen.getByRole('button', { name: 'Fechar menu' })).toBeTruthy()
  })
})

describe('CartFab', () => {
  it('fica oculto com count 0', () => {
    const { container } = render(<CartFab count={0} totalCents={0} onOpen={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('mostra aria-label com itens e total e dispara onOpen', () => {
    const onOpen = vi.fn()
    render(<CartFab count={3} totalCents={12345} onOpen={onOpen} />)
    const btn = screen.getByRole('button', { name: 'Ver sacola, 3 itens, total R$ 123,45' })
    fireEvent.click(btn)
    expect(onOpen).toHaveBeenCalled()
  })
})
