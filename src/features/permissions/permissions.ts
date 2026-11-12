/** Matriz RBAC do frontend (apenas UX). A autorização real é RLS no Postgres. */

export type AppRole =
  | 'customer'
  | 'business_owner'
  | 'business_staff'
  | 'courier_partner'
  | 'courier_own'
  | 'service_provider'
  | 'platform_operator'
  | 'platform_master'

export type MemberRole = 'owner' | 'manager' | 'attendant' | 'kitchen' | 'courier_own'

export type BusinessPermission =
  | 'store.customize'
  | 'menu.manage'
  | 'orders.view'
  | 'orders.update_status'
  | 'staff.manage'
  | 'reports.view'
  | 'settings.manage'
  | 'delivery.manage_own'
  | 'jobs.manage'
  | 'tabs.manage'
  | 'cash.manage'

export type PlatformPermission =
  | 'platform.approve_business'
  | 'platform.approve_courier'
  | 'platform.manage_plans'
  | 'platform.manage_fees'
  | 'platform.view_finance'
  | 'platform.grant_roles'

export const MEMBER_PERMISSIONS: Record<MemberRole, readonly BusinessPermission[]> = {
  owner: [
    'store.customize',
    'menu.manage',
    'orders.view',
    'orders.update_status',
    'staff.manage',
    'reports.view',
    'settings.manage',
    'delivery.manage_own',
    'jobs.manage',
    'tabs.manage',
    'cash.manage',
  ],
  manager: [
    'store.customize',
    'menu.manage',
    'orders.view',
    'orders.update_status',
    'reports.view',
    'delivery.manage_own',
    'jobs.manage',
    'tabs.manage',
    'cash.manage',
  ],
  attendant: ['orders.view', 'orders.update_status', 'tabs.manage'],
  kitchen: ['orders.view', 'orders.update_status'],
  courier_own: ['orders.view'],
}

/** Apenas master concede papéis; operador aprova e consulta. */
export const PLATFORM_PERMISSIONS: Record<
  'platform_operator' | 'platform_master',
  readonly PlatformPermission[]
> = {
  platform_operator: ['platform.approve_business', 'platform.approve_courier', 'platform.view_finance'],
  platform_master: [
    'platform.approve_business',
    'platform.approve_courier',
    'platform.manage_plans',
    'platform.manage_fees',
    'platform.view_finance',
    'platform.grant_roles',
  ],
}

export interface AuthContext {
  userId: string
  roles: readonly AppRole[]
  memberships: readonly { businessId: string; role: MemberRole }[]
}

/** Permissão de empresa: exige vínculo com ESTA empresa (isolamento multi-tenant). */
export function canInBusiness(
  ctx: AuthContext | null | undefined,
  permission: BusinessPermission,
  businessId: string,
  extras: readonly string[] = [],
): boolean {
  if (!ctx || !businessId) return false
  const membership = ctx.memberships.find((m) => m.businessId === businessId)
  if (!membership) return false
  // extras: permissões adicionais concedidas ao integrante (business_member_permissions, 0027)
  return MEMBER_PERMISSIONS[membership.role].includes(permission) || extras.includes(permission)
}

export function canOnPlatform(
  ctx: AuthContext | null | undefined,
  permission: PlatformPermission,
): boolean {
  if (!ctx) return false
  return (['platform_operator', 'platform_master'] as const).some(
    (role) => ctx.roles.includes(role) && PLATFORM_PERMISSIONS[role].includes(permission),
  )
}

export function hasRole(ctx: AuthContext | null | undefined, role: AppRole): boolean {
  return !!ctx && ctx.roles.includes(role)
}

/** Papéis que o cadastro público pode obter. Todos os demais exigem aprovação/backend. */
export const SELF_SERVICE_ROLES: readonly AppRole[] = ['customer']

/**
 * Painel inicial depois do login, por perfil (só navegação; cada painel confere a permissão no banco).
 * Equipe da plataforma → /admin; equipe de estabelecimento → painel (atendimento e cozinha direto nos pedidos);
 * entregador parceiro → área do entregador; demais → Minha conta.
 */
export function homeFor(ctx: AuthContext | null | undefined): string {
  if (!ctx) return '/conta'
  if (ctx.roles.includes('platform_master') || ctx.roles.includes('platform_operator')) return '/admin'
  const m = ctx.memberships[0]
  if (m) return m.role === 'owner' || m.role === 'manager' ? `/painel/${m.businessId}` : `/painel/${m.businessId}/pedidos`
  if (ctx.roles.includes('courier_partner')) return '/entregador'
  return '/conta'
}
