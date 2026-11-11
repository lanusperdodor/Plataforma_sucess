import type { AuthContext } from '../../features/permissions/permissions.ts'
import type { AccountIdentity } from '../../features/account/repository.ts'

const MEMBER_LABEL: Record<string, string> = {
  owner: 'Proprietário',
  manager: 'Gerente',
  attendant: 'Operador',
  kitchen: 'Cozinha',
  courier_own: 'Entregador da loja',
}

/** Nome de exibição: primeiro nome do perfil; senão usuário; senão parte do e-mail (nunca o e-mail técnico). */
export function displayName(identity: AccountIdentity | null | undefined, email: string | null | undefined): string {
  const full = identity?.fullName?.trim()
  if (full) return full.split(/\s+/)[0]!
  if (identity?.username) return identity.username
  if (email && !email.endsWith('@tucai.example.com')) return email.split('@')[0]!
  if (email) return email.split('@')[0]!
  return 'Minha conta'
}

/** Perfil ativo, discreto: "Master", "Mercadinho Teste — Operador", "Entregador"… Cliente não leva rótulo. */
export function activeRole(authz: AuthContext | null | undefined, identity: AccountIdentity | null | undefined): string | null {
  if (!authz) return null
  if (authz.roles.includes('platform_master')) return 'Master'
  if (authz.roles.includes('platform_operator')) return 'Equipe Tucaí'
  const m = authz.memberships[0]
  if (m) {
    const biz = identity?.businesses[m.businessId]
    const role = MEMBER_LABEL[m.role] ?? 'Equipe'
    return biz ? `${biz} — ${role}` : role
  }
  if (authz.roles.includes('courier_partner')) return 'Entregador'
  return null
}
