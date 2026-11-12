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
