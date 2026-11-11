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

// ---------- cidades ----------
export const adminCitySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    state: z.string(),
    slug: z.string(),
    center_lat: nullableNum,
    center_lng: nullableNum,
    is_active: z.boolean(),
    businesses_active: num,
    created_at: z.string(),
  })
  .transform((r) => ({
    id: r.id,
    name: r.name,
    state: r.state,
    slug: r.slug,
    centerLat: r.center_lat,
    centerLng: r.center_lng,
    isActive: r.is_active,
    businessesActive: r.businesses_active,
  }))
export type AdminCity = z.output<typeof adminCitySchema>

export function listCities(): Promise<AdminCity[]> {
  return rpc('admin_list_cities', undefined, z.array(adminCitySchema))
}

export interface CityInput {
  id: string | null
  name: string
  state: string
  centerLat: number | null
  centerLng: number | null
  isActive: boolean
}

export function saveCity(input: CityInput): Promise<string> {
  return rpc(
    'admin_save_city',
    {
      _id: input.id,
      _name: input.name,
      _state: input.state,
      _center_lat: input.centerLat,
      _center_lng: input.centerLng,
      _is_active: input.isActive,
    },
    z.string(),
  )
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

// ---------- dados de teste (0015) ----------
const testLoginSchema = z.object({ role: z.string(), label: z.string(), email: z.string() })
export type TestLogin = z.infer<typeof testLoginSchema>

const createdSchema = z
  .object({ run_id: z.string(), city: z.string(), password: z.string(), logins: z.array(testLoginSchema) })
  .transform((r) => ({ runId: r.run_id, city: r.city, password: r.password, logins: r.logins }))
export type CreatedTestData = z.output<typeof createdSchema>

/** Cria empresas, entregador e clientes de teste na cidade. A senha volta só nesta resposta. */
export function createTestData(cityId: string): Promise<CreatedTestData> {
  return rpc('admin_create_test_data', { _city: cityId }, createdSchema)
}

const runSchema = z
  .object({ run_id: z.string(), city_name: z.string().nullable(), created_at: z.string(), logins: z.array(testLoginSchema), businesses: z.number() })
  .transform((r) => ({ runId: r.run_id, city: r.city_name, createdAt: r.created_at, logins: r.logins, businesses: r.businesses }))
export type TestDataRun = z.output<typeof runSchema>

export function listTestData(): Promise<TestDataRun[]> {
  return rpc('admin_list_test_data', undefined, z.array(runSchema))
}

export function removeTestData(runId: string): Promise<void> {
  return rpc('admin_remove_test_data', { _run: runId }, z.any()).then(() => undefined)
}

// ---------- financeiro (0018) ----------
const financeSummarySchema = z
  .object({
    active_businesses: num, active_subscriptions: num, mrr_cents: num, received_month_cents: num, received_total_cents: num,
    open_cents: num, overdue_cents: num, fees_month_cents: num, due_soon: num,
  })
  .transform((r) => ({
    activeBusinesses: r.active_businesses, activeSubscriptions: r.active_subscriptions, mrrCents: r.mrr_cents,
    receivedMonthCents: r.received_month_cents, receivedTotalCents: r.received_total_cents, openCents: r.open_cents,
    overdueCents: r.overdue_cents, feesMonthCents: r.fees_month_cents, dueSoon: r.due_soon,
  }))
export type FinanceSummary = z.output<typeof financeSummarySchema>

export function getFinanceSummary(): Promise<FinanceSummary> {
  return rpc('admin_finance_summary', undefined, financeSummarySchema)
}

const financeBusinessSchema = z
  .object({
    business_id: z.string(), name: z.string(), slug: z.string(), business_type: z.string(), status: z.string(), city: z.string().nullable(),
    owner_name: z.string().nullable(), contact_phone: z.string().nullable(), whatsapp: z.string().nullable(),
    subscription_id: z.string().nullable(), plan_code: z.string().nullable(), plan_name: z.string().nullable(), price_cents: nullableNum,
    started_on: z.string().nullable(), current_period_end: z.string().nullable(), open_cents: num, overdue_cents: num,
    last_paid_at: z.string().nullable(), fees_month_cents: num,
  })
  .transform((r) => ({
    businessId: r.business_id, name: r.name, slug: r.slug, businessType: r.business_type, status: r.status, city: r.city,
    ownerName: r.owner_name, phone: r.contact_phone, whatsapp: r.whatsapp, subscriptionId: r.subscription_id, planCode: r.plan_code,
    planName: r.plan_name, priceCents: r.price_cents, startedOn: r.started_on, periodEnd: r.current_period_end, openCents: r.open_cents,
    overdueCents: r.overdue_cents, lastPaidAt: r.last_paid_at, feesMonthCents: r.fees_month_cents,
  }))
export type FinanceBusiness = z.output<typeof financeBusinessSchema>

export function listFinanceBusinesses(): Promise<FinanceBusiness[]> {
  return rpc('admin_finance_businesses', undefined, z.array(financeBusinessSchema))
}

export const chargeStatuses = ['aberta', 'paga', 'cancelada'] as const
export type ChargeStatus = (typeof chargeStatuses)[number]
const chargeSchema = z
  .object({
    id: z.string(), business_id: z.string(), business_name: z.string(), kind: z.enum(['plano', 'comissao', 'outro']), description: z.string(),
    amount_cents: num, due_on: z.string(), reference_month: z.string().nullable(), status: z.enum(chargeStatuses), paid_at: z.string().nullable(),
    paid_method: z.string().nullable(), created_at: z.string(),
  })
  .transform((r) => ({
    id: r.id, businessId: r.business_id, businessName: r.business_name, kind: r.kind, description: r.description, amountCents: r.amount_cents,
    dueOn: r.due_on, status: r.status, paidAt: r.paid_at, paidMethod: r.paid_method,
  }))
export type Charge = z.output<typeof chargeSchema>

export function listCharges(status: ChargeStatus | null, businessId: string | null = null): Promise<Charge[]> {
  return rpc('admin_list_charges', { _status: status, _business: businessId }, z.array(chargeSchema))
}

const planSchema = z.object({ code: z.string(), name: z.string(), price_cents: num }).transform((r) => ({ code: r.code, name: r.name, priceCents: r.price_cents }))
export type Plan = z.output<typeof planSchema>
export async function listPlans(): Promise<Plan[]> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  const { data, error } = await supabase.from('plans').select('code,name,price_cents').order('sort_order')
  if (error) throw mapPostgrestError(error)
  return z.array(planSchema).parse(data)
}

export function setSubscription(businessId: string, plan: string, startedOn: string, periodEnd: string): Promise<void> {
  return rpc('admin_set_subscription', { _business: businessId, _plan: plan, _started_on: startedOn, _period_end: periodEnd }, z.any()).then(() => undefined)
}
export function cancelSubscription(businessId: string): Promise<void> {
  return rpc('admin_cancel_subscription', { _business: businessId }, z.any()).then(() => undefined)
}
export function chargeSubscription(businessId: string): Promise<void> {
  return rpc('admin_charge_subscription', { _business: businessId }, z.any()).then(() => undefined)
}
export function chargeCommission(businessId: string, month: string): Promise<void> {
  return rpc('admin_charge_commission', { _business: businessId, _month: month }, z.any()).then(() => undefined)
}
export function markChargePaid(chargeId: string, method: string): Promise<void> {
  return rpc('admin_mark_charge_paid', { _charge: chargeId, _method: method }, z.any()).then(() => undefined)
}
export function cancelCharge(chargeId: string): Promise<void> {
  return rpc('admin_cancel_charge', { _charge: chargeId }, z.any()).then(() => undefined)
}

// ---------- meu nome no painel ----------
export async function getMyName(userId: string): Promise<string | null> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  const { data, error } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle()
  if (error) throw mapPostgrestError(error)
  return (data as { full_name: string | null } | null)?.full_name || null
}
export async function setMyName(userId: string, name: string): Promise<void> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  const { data, error } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', userId).select('id')
  if (error) throw mapPostgrestError(error)
  if (!data || data.length !== 1) throw new RepositoryError('forbidden', 'Não foi possível salvar o nome.')
}

// ---------- gateway de pagamento (0019) ----------
const gatewaySchema = z
  .object({
    provider: z.string(), mode: z.string().nullable(), public_key: z.string().nullable(), token_last4: z.string().nullable(), token_set: z.boolean(),
    webhook_secret_set: z.boolean(), integration_key_set: z.boolean(), enabled: z.boolean(), updated_at: z.string().nullable(),
  })
  .transform((r) => ({
    mode: r.mode, publicKey: r.public_key, tokenLast4: r.token_last4, tokenSet: r.token_set, webhookSecretSet: r.webhook_secret_set,
    integrationKeySet: r.integration_key_set, enabled: r.enabled, updatedAt: r.updated_at,
  }))
export type GatewaySettings = z.output<typeof gatewaySchema>

export async function getGateway(): Promise<GatewaySettings> {
  const rows = await rpc('admin_payment_gateway_get', undefined, z.array(gatewaySchema))
  return rows[0]!
}
export function saveGateway(v: { publicKey: string; accessToken: string; webhookSecret: string; enabled: boolean }): Promise<void> {
  return rpc('admin_payment_gateway_set', { _public_key: v.publicKey || null, _access_token: v.accessToken || null, _webhook_secret: v.webhookSecret || null, _enabled: v.enabled }, z.any()).then(() => undefined)
}
export function generateIntegrationKey(): Promise<string> {
  return rpc('admin_generate_integration_key', undefined, z.string())
}

// ---------- gráficos do financeiro (0020) ----------
const seriesSchema = z
  .object({ month: z.string(), received_cents: num, fees_cents: num, new_subscriptions: num })
  .transform((r) => ({ month: r.month.slice(0, 10), receivedCents: r.received_cents, feesCents: r.fees_cents, newSubscriptions: r.new_subscriptions }))
export type FinanceMonth = z.output<typeof seriesSchema>

export function getFinanceSeries(months = 12): Promise<FinanceMonth[]> {
  return rpc('admin_finance_series', { _months: months }, z.array(seriesSchema))
}

const byPlanSchema = z
  .object({ plan_code: z.string().nullable(), plan_name: z.string(), businesses: num, mrr_cents: num })
  .transform((r) => ({ planCode: r.plan_code, planName: r.plan_name, businesses: r.businesses, mrrCents: r.mrr_cents }))
export type FinanceByPlan = z.output<typeof byPlanSchema>

export function getFinanceByPlan(): Promise<FinanceByPlan[]> {
  return rpc('admin_finance_by_plan', undefined, z.array(byPlanSchema))
}
