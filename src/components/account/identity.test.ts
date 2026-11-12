import { describe, expect, it } from 'vitest'
import { activeRole, displayName } from './identity.ts'

const ident = (fullName: string | null, username: string | null = null, businesses: Record<string, string> = {}) => ({ fullName, username, businesses })
const ctx = (roles: string[], memberships: { businessId: string; role: string }[] = []) => ({ userId: 'u', roles, memberships }) as never

describe('identificação do usuário conectado', () => {
  it('usa o primeiro nome real do perfil, depois usuário, depois o e-mail', () => {
    expect(displayName(ident('João da Silva'), 'joao@x.com')).toBe('João')
    expect(displayName(ident(null, 'carlos'), 'c@x.com')).toBe('carlos')
    expect(displayName(ident(null), 'maria.souza@x.com')).toBe('maria.souza')
    expect(displayName(ident(null), 'admin@tucai.example.com')).toBe('admin')
    expect(displayName(null, null)).toBe('Minha conta')
  })
  it('mostra o perfil ativo de forma discreta', () => {
    expect(activeRole(ctx(['customer', 'platform_master']), ident('A'))).toBe('Master')
    expect(activeRole(ctx(['customer'], [{ businessId: 'b', role: 'attendant' }]), ident('A', null, { b: 'Mercadinho Teste' }))).toBe('Mercadinho Teste — Funcionário')
    expect(activeRole(ctx(['customer', 'courier_partner']), ident('Carlos'))).toBe('Entregador')
    expect(activeRole(ctx(['customer']), ident('João'))).toBeNull()
  })
})
