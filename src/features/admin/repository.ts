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
  'orders.manage',
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
const testLoginSchema = z.object({ role: z.string(), label: z.string(), email: z.string(), key: z.string().optional() })
export type TestLogin = z.infer<typeof testLoginSchema>

const createdSchema = z
  .object({ run_id: z.string(), city: z.string(), password: z.string().nullable(), logins: z.array(testLoginSchema), reused: z.boolean().optional() })
  .transform((r) => ({ runId: r.run_id, city: r.city, password: r.password, logins: r.logins, reused: r.reused ?? false }))
export type CreatedTestData = z.output<typeof createdSchema>

/** Contas de homologação dos 9 perfis na cidade, reaproveitando o lote existente. A senha das contas novas volta só nesta resposta. */
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

/** Exclui todos os lotes e restos marcados como teste (Master, confirmação "EXCLUIR"). Dados reais não entram. */
export async function removeAllTestData(confirm: string): Promise<{ lotes: number; pedidos: number; estabelecimentos: number; logins: number }> {
  return rpc('admin_remove_all_test_data', { _confirm: confirm }, z.object({ lotes: z.number(), pedidos: z.number(), estabelecimentos: z.number(), logins: z.number() }))
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

// ---------- logins / suporte às contas (0021) ----------
const accountSchema = z
  .object({
    id: z.string(), email: z.string().nullable(), full_name: z.string().nullable(), username: z.string().nullable(), phone: z.string().nullable(),
    roles: z.array(z.string()), is_test: z.boolean(), blocked: z.boolean(), created_at: z.string().nullable(), last_sign_in_at: z.string().nullable(), total: num,
  })
  .transform((r) => ({
    id: r.id, email: r.email, fullName: r.full_name, username: r.username, phone: r.phone, roles: r.roles, isTest: r.is_test,
    blocked: r.blocked, createdAt: r.created_at, lastSignInAt: r.last_sign_in_at, total: r.total,
  }))
export type Account = z.output<typeof accountSchema>
export type AccountKind = 'todos' | 'reais' | 'teste'

export function listAccounts(search: string, kind: AccountKind, limit = 50, offset = 0): Promise<Account[]> {
  return rpc('admin_list_accounts', { _search: search.trim() || null, _kind: kind, _limit: limit, _offset: offset }, z.array(accountSchema))
}
export function setAccountName(userId: string, name: string): Promise<void> {
  return rpc('admin_set_account_name', { _user: userId, _name: name }, z.any()).then(() => undefined)
}
export function setAccountUsername(userId: string, username: string): Promise<string | null> {
  return rpc('admin_set_account_username', { _user: userId, _username: username }, z.string().nullable())
}
export function setAccountPassword(userId: string, password: string): Promise<void> {
  return rpc('admin_set_account_password', { _user: userId, _password: password }, z.any()).then(() => undefined)
}
export function setAccountBlocked(userId: string, blocked: boolean): Promise<void> {
  return rpc('admin_set_account_blocked', { _user: userId, _blocked: blocked }, z.any()).then(() => undefined)
}

// ---------- pedidos (0022): acompanhamento e ocorrências ----------
const ORDER_STATUS = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'picked_up', 'rejected', 'cancelled'] as const
const DELIVERY_STATUS = ['offered', 'accepted', 'picked_up', 'delivered', 'cancelled'] as const
const adminOrderSchema = z
  .object({
    id: z.string(), code: z.string(), created_at: z.string(), status: z.enum(ORDER_STATUS),
    fulfillment: z.enum(['delivery_own', 'delivery_partner', 'pickup']), payment_method: z.enum(['cash', 'pix_on_delivery', 'card_on_delivery']),
    business_name: z.string(), city_name: z.string().nullable(), customer_name: z.string(), courier_name: z.string().nullable(),
    total_cents: z.number().int(), commission_cents: z.number().int(), platform_fee_cents: z.number().int(),
    delivery_status: z.enum(DELIVERY_STATUS).nullable(), attention: z.string().nullable(), is_test: z.boolean(), total: z.number(),
  })
  .transform((r) => ({
    id: r.id, code: r.code, createdAt: r.created_at, status: r.status, fulfillment: r.fulfillment, payment: r.payment_method,
    businessName: r.business_name, city: r.city_name, customerName: r.customer_name, courierName: r.courier_name,
    totalCents: r.total_cents, commissionCents: r.commission_cents, platformFeeCents: r.platform_fee_cents,
    deliveryStatus: r.delivery_status, attention: r.attention, isTest: r.is_test, total: r.total,
  }))
export type AdminOrder = z.output<typeof adminOrderSchema>
export type AdminOrderScope = 'abertos' | 'atencao' | 'concluidos' | 'cancelados' | 'todos'

export function listAdminOrders(scope: AdminOrderScope, search: string, includeTest: boolean, limit = 50, offset = 0): Promise<AdminOrder[]> {
  return rpc('admin_list_orders', { _scope: scope, _search: search.trim() || null, _include_test: includeTest, _limit: limit, _offset: offset }, z.array(adminOrderSchema))
}

const detailSchema = z.object({
  id: z.string(), code: z.string(), status: z.enum(ORDER_STATUS), fulfillment: z.string(), payment_method: z.string(),
  created_at: z.string(), is_test: z.boolean(), notes: z.string().nullable(), rejection_reason: z.string().nullable(),
  prep_minutes: z.number().nullable(), estimated_ready_at: z.string().nullable(), attention: z.string().nullable(),
  customer: z.object({ name: z.string(), phone: z.string().nullable(), address: z.string().nullable() }),
  business: z.object({ id: z.string(), name: z.string(), phone: z.string().nullable(), address: z.string().nullable(), city: z.string().nullable() }),
  values: z.object({
    subtotal_cents: z.number(), delivery_fee_cents: z.number(), total_cents: z.number(), commission_cents: z.number(),
    merchant_delivery_cents: z.number(), courier_pay_cents: z.number(), platform_fee_cents: z.number(), pricing_version: z.unknown(),
  }),
  items: z.array(z.object({ name: z.string(), quantity: z.number(), unit_price_cents: z.number(), line_total_cents: z.number(),
    options: z.array(z.object({ group: z.string(), option: z.string() }).passthrough()), notes: z.string().nullable() })),
  events: z.array(z.object({ status: z.enum(ORDER_STATUS), note: z.string().nullable(), at: z.string(), actor: z.string() })),
  delivery: z.object({
    status: z.enum(DELIVERY_STATUS), offer_round: z.number(), offer_expires_at: z.string().nullable(), offered_at: z.string(),
    accepted_at: z.string().nullable(), picked_up_at: z.string().nullable(), delivered_at: z.string().nullable(),
    attention_reason: z.string().nullable(), failed_code_attempts: z.number(), declines: z.number(),
    courier: z.object({ name: z.string(), phone: z.string().nullable(), vehicle: z.string(), last_lat: z.number().nullable(),
      last_lng: z.number().nullable(), last_location_at: z.string().nullable() }).nullable(),
  }).nullable(),
})
export type AdminOrderDetail = z.infer<typeof detailSchema>

export function getAdminOrder(id: string): Promise<AdminOrderDetail> {
  return rpc('admin_order_detail', { _order: id }, detailSchema)
}
export function cancelOrderAsPlatform(id: string, reason: string): Promise<void> {
  return rpc('admin_cancel_order', { _order: id, _reason: reason.trim() }, z.any()).then(() => undefined)
}
export function redispatchOrder(id: string): Promise<void> {
  return rpc('admin_redispatch', { _order: id }, z.any()).then(() => undefined)
}

// ---------- Painel Master (0023) ----------
const auditRowSchema = z
  .object({
    id: z.number(), actor_id: z.string().nullable(), actor_email: z.string().nullable(), actor_name: z.string().nullable(), action: z.string(),
    entity: z.string(), entity_id: z.string().nullable(), details: z.record(z.string(), z.unknown()).nullable(), created_at: z.string(), total: z.number(),
  })
  .transform((r) => ({ id: r.id, actorEmail: r.actor_email, actorName: r.actor_name, action: r.action, entity: r.entity, entityId: r.entity_id, details: r.details ?? {}, createdAt: r.created_at, total: r.total }))
export type AuditRow = z.output<typeof auditRowSchema>
export interface AuditFilters { action: string; actor: string; from: string; to: string }
export const AUDIT_PAGE_SIZE = 20
export function auditPage(page: number, f: AuditFilters): Promise<AuditRow[]> {
  return rpc('admin_audit_page', { _page: page, _action: f.action || null, _actor: f.actor.trim() || null, _from: f.from || null, _to: f.to || null }, z.array(auditRowSchema))
}
export function auditActions(): Promise<string[]> {
  return rpc('admin_audit_actions', undefined, z.array(z.string()))
}

const courierRowSchema = z
  .object({
    user_id: z.string(), email: z.string().nullable(), full_name: z.string(), phone: z.string(), city_name: z.string().nullable(),
    vehicle: z.enum(['moto', 'bicicleta', 'carro', 'a_pe']), vehicle_plate: z.string().nullable(), cnh_category: z.string().nullable(),
    status: z.enum(['pending', 'approved', 'rejected', 'suspended']), is_online: z.boolean(), review_note: z.string().nullable(),
    submitted_at: z.string(), reviewed_at: z.string().nullable(), deliveries_done: z.number(), deliveries_active: z.number(),
    last_delivery_at: z.string().nullable(), is_test: z.boolean(), total: z.number(),
  })
  .transform((r) => ({
    userId: r.user_id, email: r.email, fullName: r.full_name, phone: r.phone, city: r.city_name, vehicle: r.vehicle, plate: r.vehicle_plate,
    cnh: r.cnh_category, status: r.status, isOnline: r.is_online, reviewNote: r.review_note, submittedAt: r.submitted_at, reviewedAt: r.reviewed_at,
    deliveriesDone: r.deliveries_done, deliveriesActive: r.deliveries_active, lastDeliveryAt: r.last_delivery_at, isTest: r.is_test, total: r.total,
  }))
export type CourierRow = z.output<typeof courierRowSchema>
export type CourierFilter = 'todos' | 'pending' | 'approved' | 'rejected' | 'suspended'
export function couriersPage(status: CourierFilter, search: string, page: number): Promise<CourierRow[]> {
  return rpc('admin_couriers_page', { _status: status, _search: search.trim() || null, _page: page }, z.array(courierRowSchema))
}
const courierHistorySchema = z
  .object({ order_id: z.string(), order_code: z.string(), business_name: z.string(), status: z.string(), courier_pay_cents: z.number(), accepted_at: z.string().nullable(), delivered_at: z.string().nullable(), is_test: z.boolean() })
  .transform((r) => ({ orderId: r.order_id, code: r.order_code, business: r.business_name, status: r.status, payCents: r.courier_pay_cents, acceptedAt: r.accepted_at, deliveredAt: r.delivered_at, isTest: r.is_test }))
export function courierHistory(userId: string) {
  return rpc('admin_courier_history', { _user: userId }, z.array(courierHistorySchema))
}

const bizCardSchema = z
  .object({
    id: z.string(), name: z.string(), slug: z.string(), status: z.enum(['pending', 'active', 'suspended', 'rejected']),
    business_type: z.enum(['restaurante', 'loja', 'servico']), city_id: z.string().nullable(), city_name: z.string().nullable(), city_state: z.string().nullable(),
    category_id: z.string().nullable(), category_label: z.string().nullable(), owner_id: z.string().nullable(), owner_email: z.string().nullable(),
    owner_name: z.string().nullable(), phone: z.string().nullable(), description: z.string().nullable(), address_line: z.string().nullable(),
    logo_url: z.string().nullable(), cover_url: z.string().nullable(), submitted_at: z.string().nullable(), reviewed_at: z.string().nullable(),
    review_note: z.string().nullable(), created_at: z.string(), is_test: z.boolean(), total: z.number(),
  })
  .transform((r) => ({
    id: r.id, name: r.name, slug: r.slug, status: r.status, type: r.business_type, cityId: r.city_id, city: r.city_name, state: r.city_state,
    categoryId: r.category_id, category: r.category_label, ownerEmail: r.owner_email, ownerName: r.owner_name, phone: r.phone,
    description: r.description, address: r.address_line, logoUrl: r.logo_url, coverUrl: r.cover_url, submittedAt: r.submitted_at,
    reviewedAt: r.reviewed_at, reviewNote: r.review_note, createdAt: r.created_at, isTest: r.is_test, total: r.total,
  }))
export type BusinessCard = z.output<typeof bizCardSchema>
export interface BusinessFilters { status: string; search: string; city: string; category: string; type: string }
export const BUSINESS_PAGE_SIZE = 12
export function businessesPage(f: BusinessFilters, page: number): Promise<BusinessCard[]> {
  return rpc('admin_businesses_page', {
    _status: f.status || null, _search: f.search.trim() || null, _city: f.city || null, _category: f.category || null, _type: f.type || null, _page: page,
  }, z.array(bizCardSchema))
}

const accountDetailSchema = z.object({
  id: z.string(), email: z.string().nullable(), full_name: z.string().nullable(), username: z.string().nullable(), phone: z.string().nullable(),
  created_at: z.string(), last_sign_in_at: z.string().nullable(), email_confirmed: z.boolean(), blocked: z.boolean(), is_test: z.boolean(),
  must_change_password: z.boolean(), roles: z.array(z.string()), permissions: z.array(z.string()),
  memberships: z.array(z.object({ business_id: z.string(), business: z.string(), role: z.string(), status: z.string() })),
  courier: z.object({ status: z.string(), city: z.string().nullable(), vehicle: z.string(), is_online: z.boolean() }).nullable(),
  orders: z.number(),
  audit: z.array(z.object({ action: z.string(), created_at: z.string(), actor: z.string().nullable() }).passthrough()),
})
export type AccountDetail = z.infer<typeof accountDetailSchema>
export function accountDetail(userId: string): Promise<AccountDetail> {
  return rpc('admin_account_detail', { _user: userId }, accountDetailSchema)
}
/** Registra a recuperação na auditoria e devolve o e-mail; o envio do link é do Supabase Auth (fluxo público de "esqueci a senha"). */
export function startPasswordRecovery(userId: string): Promise<string> {
  return rpc('admin_password_recovery', { _user: userId }, z.string())
}

export type StaffRole = 'platform_operator' | 'platform_master'
export function inviteStaff(email: string, role: StaffRole, permissions: string[], confirm: string): Promise<'vinculado' | 'convidado'> {
  return rpc('admin_invite_staff', { _email: email.trim(), _role: role, _permissions: permissions, _confirm: confirm || null }, z.enum(['vinculado', 'convidado']))
}
const inviteSchema = z
  .object({ id: z.string(), email: z.string(), role: z.string(), permissions: z.array(z.string()), created_at: z.string(), expires_at: z.string(), status: z.string() })
  .transform((r) => ({ id: r.id, email: r.email, role: r.role, permissions: r.permissions, createdAt: r.created_at, expiresAt: r.expires_at, status: r.status }))
export type StaffInvite = z.output<typeof inviteSchema>
export function listInvites(): Promise<StaffInvite[]> {
  return rpc('admin_list_invites', undefined, z.array(inviteSchema))
}
export function revokeInvite(id: string): Promise<void> {
  return rpc('admin_revoke_invite', { _id: id }, z.any()).then(() => undefined)
}
export function grantMaster(userId: string): Promise<void> {
  return rpc('grant_role', { _user: userId, _role: 'platform_master' }, z.any()).then(() => undefined)
}
export function revokeMaster(userId: string): Promise<void> {
  return rpc('revoke_role', { _user: userId, _role: 'platform_master' }, z.any()).then(() => undefined)
}

const cents = z.number()
const financeReportSchema = z.object({
  confirmado: z.object({ pedidos: z.number(), volume_bruto_cents: cents, produtos_cents: cents, comissao_cents: cents, taxas_plataforma_cents: cents, devido_entregadores_cents: cents, logistica_estabelecimentos_cents: cents }),
  previsto: z.object({ pedidos: z.number(), volume_bruto_cents: cents, comissao_cents: cents, taxas_plataforma_cents: cents }),
  cancelados: z.object({ pedidos: z.number(), volume_cents: cents }),
  mensalidades: z.object({ recebido_cents: cents, recebido_online_cents: cents, a_receber_cents: cents, vencido_cents: cents }),
  repassado: z.object({ entregadores_cents: cents, registrado: z.boolean() }),
  reembolsos: z.object({ cents, registrado: z.boolean() }),
  por_estabelecimento: z.array(z.object({ estabelecimento: z.string(), pedidos: z.number(), volume_cents: cents, plataforma_cents: cents })),
  por_cidade: z.array(z.object({ cidade: z.string(), pedidos: z.number(), volume_cents: cents })),
})
export type FinanceReport = z.infer<typeof financeReportSchema>
export interface FinanceFilters { from: string; to: string; city: string; business: string; includeTest: boolean }
export function financeReport(f: FinanceFilters): Promise<FinanceReport> {
  return rpc('admin_finance_report', { _from: f.from, _to: f.to, _city: f.city || null, _business: f.business || null, _include_test: f.includeTest }, financeReportSchema)
}
const txSchema = z
  .object({ kind: z.string(), ref: z.string(), occurred_at: z.string(), business_name: z.string(), city_name: z.string().nullable(), description: z.string(),
    status: z.string(), amount_cents: z.number(), platform_cents: z.number(), courier_cents: z.number(), method: z.string().nullable(), total: z.number() })
  .transform((r) => ({ kind: r.kind, ref: r.ref, at: r.occurred_at, business: r.business_name, city: r.city_name, description: r.description, status: r.status,
    amountCents: r.amount_cents, platformCents: r.platform_cents, courierCents: r.courier_cents, method: r.method, total: r.total }))
export type FinanceTx = z.output<typeof txSchema>
export function financeTransactions(f: FinanceFilters, kind: 'todos' | 'pedido' | 'cobranca', page: number): Promise<FinanceTx[]> {
  return rpc('admin_finance_transactions', { _from: f.from, _to: f.to, _city: f.city || null, _business: f.business || null, _kind: kind, _include_test: f.includeTest, _page: page }, z.array(txSchema))
}

const paymentSchema = z
  .object({ id: z.string(), business_name: z.string(), kind: z.string(), description: z.string(), amount_cents: z.number(), due_on: z.string(),
    status: z.enum(['aberta', 'paga', 'cancelada']), paid_at: z.string().nullable(), paid_method: z.string().nullable(), provider: z.string().nullable(),
    provider_payment_id: z.string().nullable(), created_at: z.string(), events: z.array(z.object({ action: z.string(), at: z.string() })), total: z.number() })
  .transform((r) => ({ id: r.id, business: r.business_name, kind: r.kind, description: r.description, amountCents: r.amount_cents, dueOn: r.due_on,
    status: r.status, paidAt: r.paid_at, paidMethod: r.paid_method, provider: r.provider, providerPaymentId: r.provider_payment_id, createdAt: r.created_at,
    events: r.events, total: r.total }))
export type PaymentRow = z.output<typeof paymentSchema>
export function paymentsPage(status: string, search: string, origin: 'todos' | 'online' | 'manual', page: number): Promise<PaymentRow[]> {
  return rpc('admin_payments_page', { _status: status || null, _search: search.trim() || null, _origin: origin, _page: page }, z.array(paymentSchema))
}
