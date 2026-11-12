import { describe, expect, it } from 'vitest'
import { availableContexts, resolveContext } from './activeContext.ts'

const ctx = (roles: string[], memberships: { businessId: string; role: string }[] = []) => ({ userId: 'u', roles, memberships }) as never

describe('perfil ativo', () => {
  it('lojista/empresário só tem o perfil empresarial (sem cliente)', () => {
    const owner = ctx(['customer'], [{ businessId: 'b1', role: 'owner' }])
    expect(availableContexts(owner)).toEqual([{ kind: 'loja', businessId: 'b1' }])
    expect(resolveContext('cliente', owner)).toEqual({ kind: 'loja', businessId: 'b1' })
    expect(resolveContext('qualquer', owner)).toEqual({ kind: 'loja', businessId: 'b1' })
  })
  it('cliente comum e entregador mantêm o perfil de cliente', () => {
    expect(availableContexts(ctx(['customer']))).toEqual([{ kind: 'cliente' }])
    expect(availableContexts(ctx(['customer', 'courier_partner'])).map((c) => c.kind)).toEqual(['cliente', 'entregador'])
    expect(resolveContext('entregador', ctx(['customer']))).toEqual({ kind: 'cliente' })
  })
})

import { destinationsFor } from '../components/shell/destinations.ts'
import { availableContexts as ctxs, resolveContext as resolve } from './activeContext.ts'

describe('aba Pedidos por perfil', () => {
  const ids = (authz: Parameters<typeof ctxs>[0]) => destinationsFor(resolve('cliente', authz)).map((d) => d.label)
  it('Master e operador: sem perfil de cliente e sem aba Pedidos', () => {
    const master = { userId: 'm', roles: ['customer', 'platform_master'] as const, memberships: [] }
    expect(ctxs(master).map((c) => c.kind)).toEqual(['master'])
    expect(ids(master)).not.toContain('Pedidos')
    expect(ids({ userId: 'o', roles: ['platform_operator'], memberships: [] })).not.toContain('Pedidos')
  })
  it('cliente, empresário e entregador continuam com seus pedidos/entregas', () => {
    expect(ids({ userId: 'c', roles: ['customer'], memberships: [] })).toContain('Pedidos')
    expect(ids({ userId: 'l', roles: ['customer'], memberships: [{ businessId: 'b1', role: 'owner' }] })).toContain('Pedidos')
    expect(destinationsFor(resolve('entregador', { userId: 'k', roles: ['customer', 'courier_partner'], memberships: [] })).map((d) => d.label)).toContain('Entregas')
  })
})

describe('login único: quatro perfis + Master', () => {
  const kinds = (authz: Parameters<typeof ctxs>[0]) => ctxs(authz).map((c) => c.kind)
  it('empresário e funcionário vão para o estabelecimento; entregador próprio para entregas; cliente para compras', () => {
    expect(kinds({ userId: 'e', roles: ['customer'], memberships: [{ businessId: 'b1', role: 'owner' }] })).toEqual(['loja'])
    expect(kinds({ userId: 'f', roles: ['customer'], memberships: [{ businessId: 'b1', role: 'attendant' }] })).toEqual(['loja'])
    expect(kinds({ userId: 'p', roles: ['customer'], memberships: [{ businessId: 'b2', role: 'courier_own' }] })).toEqual(['cliente', 'entregador'])
    expect(kinds({ userId: 'k', roles: ['customer', 'courier_partner'], memberships: [] })).toEqual(['cliente', 'entregador'])
    expect(kinds({ userId: 'c', roles: ['customer'], memberships: [] })).toEqual(['cliente'])
  })
  it('a mesma conta alterna entre os painéis que tem, sem conta duplicada', () => {
    expect(kinds({ userId: 'x', roles: ['customer', 'courier_partner'], memberships: [{ businessId: 'b1', role: 'owner' }] })).toEqual(['loja', 'entregador'])
  })
})
