import { z, type ZodType } from 'zod'
import { RepositoryError, backendUnavailable, mapPostgrestError } from '../../lib/errors'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'

/**
 * Cliente das funções administrativas (0005_platform_admin.sql).
 * Toda autorização acontece no servidor (SECURITY DEFINER + permissões + MFA); aqui só
 * chamamos as funções e validamos o formato das respostas.
 */

export const businessStatuses = ['pending', 'active', 'suspended', 'rejected'] as const
export type BusinessStatus = (typeof businessStatuses)[number]
export type ReviewDecision = 'approve' | 'reject' | 'suspend' | 'reactivate'

export const PLATFORM_PERMISSION_CODES = [
  'admin.dashboard',
  'users.view',
  'businesses.review',
  'cities.manage',
  'audit.view',
  'privacy.manage',
  'couriers.review',
  'orders.view',
  'finance.view',
  'moderation.manage',
  'support.manage',
  'campaigns.manage',
  'jobs.manage',
] as const
export type PlatformPermissionCode = (typeof PLATFORM_PERMISSION_CODES)[number]

async function rpc<T>(fn: string, args: Record<string, unknown> | undefined, schema: ZodType<T>): Promise<T> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  let res: { data: unknown; error: { code?: string; message: string } | null }
  try {
    res = (await supabase.rpc(fn, args)) as typeof res
  } catch (e) {
    throw mapPostgrestError({ message: e instanceof Error ? e.message : String(e) })
  }
  if (res.error) throw mapPostgrestError(res.error)
  const parsed = schema.safeParse(res.data)
  if (!parsed.success) {
    throw new RepositoryError('validation', 'Recebemos dados inesperados do servidor.', undefined, { cause: parsed.error })
  }
  return parsed.data
}

const num = z.coerce.number()
const nullableNum = z.union([z.coerce.number(), z.null()])

// ---------- acesso ----------
export const adminAccessSchema = z
  .object({
    is_master: z.boolean(),
    is_operator: z.boolean(),
    mfa_required: z.boolean(),
    aal: z.string(),
    mfa_ok: z.boolean(),
    permissions: z.array(z.string()),
  })
  .transform((r) => ({
    isMaster: r.is_master,
    isOperator: r.is_operator,
    mfaRequired: r.mfa_required,
    aal: r.aal,
    mfaOk: r.mfa_ok,
    permissions: r.permissions,
  }))
export type AdminAccess = z.output<typeof adminAccessSchema>

export function getMyAccess(): Promise<AdminAccess> {
  return rpc('admin_my_access', undefined, adminAccessSchema)
}

export function canAdmin(access: AdminAccess | undefined, permission: PlatformPermissionCode): boolean {
  return !!access && access.mfaOk && access.permissions.includes(permission)
}

// ---------- painel ----------
export const dashboardSchema = z
  .object({
    users_total: num,
    businesses: z.record(z.string(), num),
    cities_active: num,
    staff_total: num,
    audit_last_24h: num,
    generated_at: z.string(),
  })
  .transform((r) => ({
    usersTotal: r.users_total,
    businesses: {
      pending: r.businesses.pending ?? 0,
      active: r.businesses.active ?? 0,
      suspended: r.businesses.suspended ?? 0,
      rejected: r.businesses.rejected ?? 0,
    },
    citiesActive: r.cities_active,
    staffTotal: r.staff_total,
    auditLast24h: r.audit_last_24h,
    generatedAt: r.generated_at,
  }))
export type AdminDashboard = z.output<typeof dashboardSchema>

export function getDashboard(): Promise<AdminDashboard> {
  return rpc('admin_dashboard', undefined, dashboardSchema)
}

// ---------- estabelecimentos ----------
export const adminBusinessSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    status: z.enum(businessStatuses),
    business_type: z.enum(['restaurante', 'loja', 'servico']),
    city_name: z.string().nullable(),
    city_state: z.string().nullable(),
    category_label: z.string().nullable(),
    owner_id: z.string(),
    owner_email: z.string().nullable(),
    owner_name: z.string().nullable(),
    phone: z.string().nullable(),
    description: z.string().nullable(),
    address_line: z.string().nullable(),
    submitted_at: z.string().nullable(),
    reviewed_at: z.string().nullable(),
    review_note: z.string().nullable(),
    created_at: z.string(),
  })
  .transform((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    businessType: r.business_type,
    city: r.city_name ? `${r.city_name}, ${r.city_state ?? ''}`.replace(/, $/, '') : null,
    categoryLabel: r.category_label,
    ownerEmail: r.owner_email,
    ownerName: r.owner_name,
    phone: r.phone,
    description: r.description,
    addressLine: r.address_line,
    submittedAt: r.submitted_at,
    reviewedAt: r.reviewed_at,
    reviewNote: r.review_note,
    createdAt: r.created_at,
  }))
export type AdminBusiness = z.output<typeof adminBusinessSchema>

export function listBusinesses(status: BusinessStatus | null, search = '', page = 0, pageSize = 50): Promise<AdminBusiness[]> {
  return rpc(
    'admin_list_businesses',
    { _status: status, _search: search.trim() || null, _limit: pageSize, _offset: page * pageSize },
    z.array(adminBusinessSchema),
  )
}

export function reviewBusiness(businessId: string, decision: ReviewDecision, note?: string): Promise<BusinessStatus> {
  return rpc(
    'admin_review_business',
    { _business: businessId, _decision: decision, _note: note?.trim() || null },
    z.enum(businessStatuses),
  )
}

// ---------- cidades (0010: base IBGE, raio de atendimento, situação) ----------
export const cityStatuses = ['planned', 'active', 'suspended'] as const
export type CityStatus = (typeof cityStatuses)[number]
export const CITY_STATUS_LABEL: Record<CityStatus, string> = { planned: 'Planejada', active: 'Ativa', suspended: 'Suspensa' }

export const adminCitySchema = z
  .object({
    id: z.string(),
    ibge_code: z.number().int().nullable(),
    name: z.string(),
    state: z.string(),
    slug: z.string(),
    center_lat: nullableNum,
    center_lng: nullableNum,
    status: z.enum(cityStatuses),
    distance_from_hq_km: nullableNum,
    businesses_active: num,
    status_changed_at: z.string().nullable(),
    total_count: num,
  })
  .transform((r) => ({
    id: r.id,
    ibgeCode: r.ibge_code,
    name: r.name,
    state: r.state,
    slug: r.slug,
    centerLat: r.center_lat,
    centerLng: r.center_lng,
    status: r.status,
    distanceFromHqKm: r.distance_from_hq_km,
    businessesActive: r.businesses_active,
    statusChangedAt: r.status_changed_at,
    totalCount: r.total_count,
  }))
export type AdminCity = z.output<typeof adminCitySchema>

export interface AdminCityFilters {
  search?: string
  state?: string
  status?: CityStatus | ''
  maxDistanceKm?: number | null
  limit?: number
  offset?: number
}

export function listCities(f: AdminCityFilters = {}): Promise<AdminCity[]> {
  return rpc(
    'admin_list_cities',
    {
      _search: f.search?.trim() || null,
      _state: f.state?.trim() || null,
      _status: f.status || null,
      _max_distance_km: f.maxDistanceKm ?? null,
      _limit: f.limit ?? 100,
      _offset: f.offset ?? 0,
    },
    z.array(adminCitySchema),
  )
}

export function setCityStatus(cityId: string, status: CityStatus, reason?: string): Promise<CityStatus> {
  return rpc('admin_set_city_status', { _city: cityId, _status: status, _reason: reason?.trim() || null }, z.enum(cityStatuses))
}

/** Vincula cidade antiga (sem código) ao município IBGE; o servidor confere nome e UF. */
export function linkCityIbge(cityId: string, ibgeCode: number): Promise<void> {
  return rpc('admin_link_city_ibge', { _city: cityId, _ibge_code: ibgeCode }, z.unknown()).then(() => undefined)
}

/** Cadastra, como planejadas, as cidades elegíveis que faltarem. Devolve quantas entraram. */
export function syncEligibleCities(): Promise<number> {
  return rpc('admin_sync_eligible_cities', undefined, num)
}

const coverageCity = z.object({ name: z.string(), state: z.string() })
export const cityCoverageSchema = z
  .object({
    hq: z.object({ ibge_code: z.number(), name: z.string(), state: z.string() }).nullable(),
    service_radius_km: num,
    discovery_radius_km: num,
    eligible_states: z.array(z.string()),
    reference_total: num,
    eligible_total: num,
    by_status: z.record(z.string(), num),
    missing_eligible: z.array(coverageCity.extend({ ibge_code: z.number(), distance_km: num })),
    without_ibge: z.array(coverageCity.extend({ id: z.string(), status: z.enum(cityStatuses) })),
    outside_area: z.array(coverageCity.extend({ id: z.string(), status: z.enum(cityStatuses), distance_km: nullableNum })),
    coordinates_divergent: z.array(coverageCity.extend({ id: z.string(), offset_km: num })),
  })
  .transform((r) => ({
    hq: r.hq,
    serviceRadiusKm: r.service_radius_km,
    discoveryRadiusKm: r.discovery_radius_km,
    eligibleStates: r.eligible_states,
    referenceTotal: r.reference_total,
    eligibleTotal: r.eligible_total,
    byStatus: { planned: r.by_status.planned ?? 0, active: r.by_status.active ?? 0, suspended: r.by_status.suspended ?? 0 },
    missingEligible: r.missing_eligible,
    withoutIbge: r.without_ibge,
    outsideArea: r.outside_area,
    coordinatesDivergent: r.coordinates_divergent,
  }))
export type CityCoverage = z.output<typeof cityCoverageSchema>

export function getCityCoverage(): Promise<CityCoverage> {
  return rpc('admin_city_coverage', undefined, cityCoverageSchema)
}

// ---------- equipe ----------
export const staffSchema = z
  .object({
    user_id: z.string(),
    email: z.string().nullable(),
    full_name: z.string().nullable(),
    roles: z.array(z.string()).nullable(),
    permissions: z.array(z.string()),
  })
  .transform((r) => ({
    userId: r.user_id,
    email: r.email,
    fullName: r.full_name,
    roles: r.roles ?? [],
    permissions: r.permissions,
  }))
export type StaffMember = z.output<typeof staffSchema>

export function listStaff(): Promise<StaffMember[]> {
  return rpc('admin_list_staff', undefined, z.array(staffSchema))
}

export const foundUserSchema = z
  .object({
    user_id: z.string(),
    email: z.string().nullable(),
    full_name: z.string().nullable(),
    roles: z.array(z.string()),
  })
  .transform((r) => ({ userId: r.user_id, email: r.email, fullName: r.full_name, roles: r.roles }))
export type FoundUser = z.output<typeof foundUserSchema>

export async function findUserByEmail(email: string): Promise<FoundUser | null> {
  const rows = await rpc('admin_find_user', { _email: email }, z.array(foundUserSchema))
  return rows[0] ?? null
}

export function setStaffPermission(userId: string, permission: string, granted: boolean): Promise<void> {
  return rpc('admin_set_staff_permission', { _user: userId, _permission: permission, _granted: granted }, z.any()).then(
    () => undefined,
  )
}

export function grantOperatorRole(userId: string): Promise<void> {
  return rpc('grant_role', { _user: userId, _role: 'platform_operator' }, z.any()).then(() => undefined)
}

export function revokeOperatorRole(userId: string): Promise<void> {
  return rpc('revoke_role', { _user: userId, _role: 'platform_operator' }, z.any()).then(() => undefined)
}

// ---------- auditoria ----------
export const auditEntrySchema = z
  .object({
    id: num,
    actor_id: z.string().nullable(),
    actor_email: z.string().nullable(),
    action: z.string(),
    entity: z.string(),
    entity_id: z.string().nullable(),
    details: z.record(z.string(), z.unknown()),
    created_at: z.string(),
  })
  .transform((r) => ({
    id: r.id,
    actorEmail: r.actor_email,
    action: r.action,
    entity: r.entity,
    entityId: r.entity_id,
    details: r.details,
    createdAt: r.created_at,
  }))
export type AuditEntry = z.output<typeof auditEntrySchema>

export function listAudit(beforeId: number | null, limit = 50): Promise<AuditEntry[]> {
  return rpc('admin_list_audit', { _limit: limit, _before_id: beforeId }, z.array(auditEntrySchema))
}

// ---------- configurações ----------
export const settingSchema = z
  .object({ key: z.string(), value: z.unknown(), updated_at: z.string() })
  .transform((r) => ({ key: r.key, value: r.value, updatedAt: r.updated_at }))
export type PlatformSetting = z.output<typeof settingSchema>

export function listSettings(): Promise<PlatformSetting[]> {
  return rpc('admin_list_settings', undefined, z.array(settingSchema))
}

export function setSetting(key: string, value: unknown): Promise<void> {
  return rpc('admin_set_setting', { _key: key, _value: value }, z.any()).then(() => undefined)
}
