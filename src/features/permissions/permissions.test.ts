import { describe, expect, it } from 'vitest'
import { canInBusiness, canOnPlatform, hasRole, type AuthContext } from './permissions.ts'

const A = 'business-a'
const B = 'business-b'

const ownerA: AuthContext = {
  userId: 'u1',
  roles: ['customer', 'business_owner'],
  memberships: [{ businessId: A, role: 'owner' }],
}
const kitchenA: AuthContext = {
  userId: 'u2',
  roles: ['business_staff'],
  memberships: [{ businessId: A, role: 'kitchen' }],
}
const customer: AuthContext = { userId: 'u3', roles: ['customer'], memberships: [] }

describe('RBAC', () => {
  it('bloqueia usuário não autenticado', () => {
    expect(canInBusiness(null, 'orders.view', A)).toBe(false)
    expect(canOnPlatform(undefined, 'platform.view_finance')).toBe(false)
  })

  it('isola empresas: dono da A não acessa a B', () => {
    expect(canInBusiness(ownerA, 'menu.manage', A)).toBe(true)
    expect(canInBusiness(ownerA, 'menu.manage', B)).toBe(false)
  })

  it('funcionário respeita limites do cargo', () => {
    expect(canInBusiness(kitchenA, 'orders.update_status', A)).toBe(true)
    expect(canInBusiness(kitchenA, 'staff.manage', A)).toBe(false)
    expect(canInBusiness(kitchenA, 'reports.view', A)).toBe(false)
  })

  it('cliente comum não tem permissão de empresa nem de plataforma', () => {
    expect(canInBusiness(customer, 'orders.view', A)).toBe(false)
    expect(canOnPlatform(customer, 'platform.grant_roles')).toBe(false)
  })

  it('papel de empresa não concede permissão de plataforma', () => {
    expect(canOnPlatform(ownerA, 'platform.manage_fees')).toBe(false)
  })

  it('somente master concede papéis e altera taxas; operador não', () => {
    const op: AuthContext = { userId: 'o', roles: ['platform_operator'], memberships: [] }
    const master: AuthContext = { userId: 'm', roles: ['platform_master'], memberships: [] }
    expect(canOnPlatform(op, 'platform.approve_business')).toBe(true)
    expect(canOnPlatform(op, 'platform.grant_roles')).toBe(false)
    expect(canOnPlatform(op, 'platform.manage_fees')).toBe(false)
    expect(canOnPlatform(master, 'platform.grant_roles')).toBe(true)
  })

  it('permite múltiplos papéis', () => {
    expect(hasRole(ownerA, 'customer')).toBe(true)
    expect(hasRole(ownerA, 'business_owner')).toBe(true)
    expect(hasRole(ownerA, 'platform_master')).toBe(false)
  })
})
