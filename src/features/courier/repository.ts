import { z } from 'zod'
import { RepositoryError, backendUnavailable, mapPostgrestError } from '../../lib/errors'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'

/** Entregadores parceiros (0009). Escrita só por funções no servidor. */

export const vehicles = ['moto', 'bicicleta', 'carro', 'a_pe'] as const
export type Vehicle = (typeof vehicles)[number]
export const VEHICLE_LABEL: Record<Vehicle, string> = { moto: 'Moto', bicicleta: 'Bicicleta', carro: 'Carro', a_pe: 'A pé' }
export const courierStatuses = ['pending', 'approved', 'rejected', 'suspended'] as const
export type CourierStatus = (typeof courierStatuses)[number]

type Res = { data: unknown; error: { code?: string; message: string } | null }
async function exec<T>(q: PromiseLike<Res>, schema: z.ZodType<T>): Promise<T> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  let res: Res
  try {
    res = await q
  } catch (e) {
    throw mapPostgrestError({ message: e instanceof Error ? e.message : String(e) })
  }
  if (res.error) throw mapPostgrestError(res.error)
  const parsed = schema.safeParse(res.data)
  if (!parsed.success) throw new RepositoryError('validation', 'Recebemos dados inesperados do servidor.', undefined, { cause: parsed.error })
  return parsed.data
}

const motorized = (v: Vehicle) => v === 'moto' || v === 'carro'

export const courierFormSchema = z
  .object({
    fullName: z.string().trim().min(3, 'Informe seu nome completo.').max(120),
    phone: z.string().trim().regex(/^[0-9+() -]{8,20}$/, 'Telefone inválido. Ex.: (35) 99999-0000'),
    cityId: z.string().min(1, 'Escolha a cidade.'),
    vehicle: z.enum(vehicles),
    plate: z.string().trim(),
    cnh: z.string().trim(),
    acceptTerms: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (!v.acceptTerms) ctx.addIssue({ code: 'custom', path: ['acceptTerms'], message: 'É preciso aceitar os termos de parceria.' })
    if (motorized(v.vehicle)) {
      if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(v.plate.toUpperCase().replace(/[^A-Z0-9]/g, '')))
        ctx.addIssue({ code: 'custom', path: ['plate'], message: 'Placa inválida. Ex.: ABC1D23' })
      if (!['A', 'B', 'AB', 'AC', 'AD', 'AE'].includes(v.cnh.toUpperCase()))
        ctx.addIssue({ code: 'custom', path: ['cnh'], message: 'Categoria da CNH inválida.' })
    }
  })
export type CourierForm = z.input<typeof courierFormSchema>

export function courierFormToArgs(input: CourierForm) {
  const v = courierFormSchema.parse(input)
  return {
    _full_name: v.fullName,
    _phone: v.phone,
    _city_id: v.cityId,
    _vehicle: v.vehicle,
    _vehicle_plate: motorized(v.vehicle) ? v.plate.toUpperCase().replace(/[^A-Z0-9]/g, '') : null,
    _cnh_category: motorized(v.vehicle) ? v.cnh.toUpperCase() : null,
    _accept_terms: v.acceptTerms,
  }
}

export async function submitCourierApplication(input: CourierForm): Promise<CourierStatus> {
  return exec(supabase.rpc('submit_courier_application', courierFormToArgs(input)), z.enum(courierStatuses))
}

const mySchema = z
  .object({
    full_name: z.string(), phone: z.string(), city_id: z.string(), vehicle: z.enum(vehicles), vehicle_plate: z.string().nullable(),
    cnh_category: z.string().nullable(), status: z.enum(courierStatuses), is_online: z.boolean(), review_note: z.string().nullable(), submitted_at: z.string(),
  })
  .transform((r) => ({
    fullName: r.full_name, phone: r.phone, cityId: r.city_id, vehicle: r.vehicle, plate: r.vehicle_plate, cnh: r.cnh_category,
    status: r.status, isOnline: r.is_online, reviewNote: r.review_note, submittedAt: r.submitted_at,
  }))
export type MyCourier = z.output<typeof mySchema>

export async function getMyCourier(userId: string): Promise<MyCourier | null> {
  return exec(
    supabase.from('couriers').select('full_name,phone,city_id,vehicle,vehicle_plate,cnh_category,status,is_online,review_note,submitted_at').eq('user_id', userId).maybeSingle(),
    mySchema.nullable(),
  )
}

export async function setOnline(online: boolean): Promise<boolean> {
  return exec(supabase.rpc('set_courier_online', { _online: online }), z.boolean())
}

// ---------- equipe ----------
const adminSchema = z
  .object({
    user_id: z.string(), email: z.string().nullable(), full_name: z.string(), phone: z.string(), city_name: z.string().nullable(),
    vehicle: z.enum(vehicles), vehicle_plate: z.string().nullable(), cnh_category: z.string().nullable(), status: z.enum(courierStatuses),
    is_online: z.boolean(), review_note: z.string().nullable(), submitted_at: z.string(), reviewed_at: z.string().nullable(),
  })
  .transform((r) => ({
    userId: r.user_id, email: r.email, fullName: r.full_name, phone: r.phone, city: r.city_name, vehicle: r.vehicle, plate: r.vehicle_plate,
    cnh: r.cnh_category, status: r.status, isOnline: r.is_online, reviewNote: r.review_note, submittedAt: r.submitted_at, reviewedAt: r.reviewed_at,
  }))
export type AdminCourier = z.output<typeof adminSchema>

export async function adminListCouriers(status: CourierStatus | null): Promise<AdminCourier[]> {
  return exec(supabase.rpc('admin_list_couriers', { _status: status }), z.array(adminSchema))
}

export async function adminReviewCourier(userId: string, decision: 'approve' | 'reject' | 'suspend' | 'reactivate', note = ''): Promise<CourierStatus> {
  return exec(supabase.rpc('admin_review_courier', { _user: userId, _decision: decision, _note: note.trim() || null }), z.enum(courierStatuses))
}

// ---------- entregas (0012) ----------
const offerSchema = z
  .object({
    order_id: z.string(), business_name: z.string(), business_address: z.string().nullable(), courier_pay_cents: z.number().int(),
    offered_at: z.string(), neighborhood_hint: z.string().nullable(), items_count: z.number(),
    offer_expires_at: z.string().nullable().optional(), offer_round: z.number().int().optional(),
    order_status: z.string().nullable().optional(), city_name: z.string().nullable().optional(),
  })
  .transform((r) => ({
    orderId: r.order_id, businessName: r.business_name, businessAddress: r.business_address, payCents: r.courier_pay_cents,
    offeredAt: r.offered_at, neighborhood: r.neighborhood_hint, itemsCount: r.items_count,
    expiresAt: r.offer_expires_at ?? null, round: r.offer_round ?? 1,
    /** Etapa do pedido na loja (oferta antecipada, 0026): a coleta só é liberada quando 'ready'. */
    orderStatus: r.order_status ?? null, city: r.city_name ?? null,
  }))
export type DeliveryOffer = z.output<typeof offerSchema>

export async function listOffers(): Promise<DeliveryOffer[]> {
  return exec(supabase.rpc('courier_list_offers'), z.array(offerSchema))
}

const myDeliverySchema = z
  .object({
    order_id: z.string(), order_code: z.string(), status: z.enum(['offered', 'accepted', 'picked_up', 'delivered', 'cancelled']),
    business_name: z.string(), business_address: z.string().nullable(), business_phone: z.string().nullable(), customer_name: z.string().nullable(),
    customer_phone: z.string().nullable(), delivery_address: z.string().nullable(), delivery_reference: z.string().nullable(),
    payment_method: z.enum(['cash', 'pix_on_delivery', 'card_on_delivery']), total_cents: z.number().int(), change_for_cents: z.number().int().nullable(),
    courier_pay_cents: z.number().int(), accepted_at: z.string().nullable(), delivered_at: z.string().nullable(),
    order_status: z.string().nullable().optional(),
  })
  .transform((r) => ({
    orderId: r.order_id, code: r.order_code, status: r.status, businessName: r.business_name, businessAddress: r.business_address,
    businessPhone: r.business_phone, customerName: r.customer_name, customerPhone: r.customer_phone, address: r.delivery_address,
    reference: r.delivery_reference, payment: r.payment_method, totalCents: r.total_cents, changeForCents: r.change_for_cents,
    payCents: r.courier_pay_cents, acceptedAt: r.accepted_at, deliveredAt: r.delivered_at, orderStatus: r.order_status ?? null,
  }))
export type CourierDelivery = z.output<typeof myDeliverySchema>

export async function myDeliveries(active: boolean): Promise<CourierDelivery[]> {
  return exec(supabase.rpc('courier_my_deliveries', { _active: active }), z.array(myDeliverySchema))
}

export async function acceptDelivery(orderId: string): Promise<void> {
  await exec(supabase.rpc('courier_accept_delivery', { _order: orderId }), z.unknown())
}
export async function releaseDelivery(orderId: string): Promise<void> {
  await exec(supabase.rpc('courier_release_delivery', { _order: orderId }), z.unknown())
}

/** Recusa a oferta nesta rodada (ela volta a aparecer se for redistribuída). */
export async function declineOffer(orderId: string): Promise<void> {
  await exec(supabase.rpc('courier_decline_delivery', { _order: orderId }), z.unknown())
}

/** Compartilha a posição atual (só enquanto disponível; apagada ao ficar indisponível). */
export async function shareLocation(lat: number, lng: number): Promise<void> {
  await exec(supabase.rpc('courier_update_location', { _lat: lat, _lng: lng }), z.unknown())
}
export async function pickupDelivery(orderId: string): Promise<void> {
  await exec(supabase.rpc('courier_pickup_delivery', { _order: orderId }), z.unknown())
}
export type CodeCheck = { ok: true } | { ok: false; reason: 'invalido' | 'bloqueado'; lockedUntil: string | null }
const codeCheckSchema = z
  .object({ ok: z.boolean(), reason: z.enum(['invalido', 'bloqueado']).optional(), locked_until: z.string().nullable().optional() })
  .transform((r): CodeCheck => (r.ok ? { ok: true } : { ok: false, reason: r.reason ?? 'invalido', lockedUntil: r.locked_until ?? null }))
/** Etapa 1: o banco confere o código dito pelo cliente; nunca devolve o código esperado. */
export async function verifyDeliveryCode(orderId: string, code: string): Promise<CodeCheck> {
  return exec(supabase.rpc('courier_verify_code', { _order: orderId, _code: code.trim() }), codeCheckSchema)
}
/** Etapa 2: finaliza (só com código validado). O identificador da operação torna a repetição segura. */
export async function finishDelivery(orderId: string, opId: string): Promise<'finalizada' | 'ja_finalizada'> {
  return exec(supabase.rpc('courier_finish_delivery', { _order: orderId, _op: opId }), z.enum(['finalizada', 'ja_finalizada']))
}
/** Devolve true se o código conferiu e a entrega foi concluída. */
export async function completeDelivery(orderId: string, code: string): Promise<boolean> {
  await exec(supabase.rpc('courier_complete_delivery', { _order: orderId, _code: code.trim() }), z.unknown())
  const still = await myDeliveries(true)
  return !still.some((d) => d.orderId === orderId)
}

const walletSchema = z
  .object({
    today_cents: z.number(), week_cents: z.number(), total_cents: z.number().optional(), deliveries: z.number(),
    ganho_total_cents: z.number().optional(), guardado_cents: z.number().optional(), disponivel_cents: z.number().optional(),
    em_saque_cents: z.number().optional(), sacado_cents: z.number().optional(), dias_guardado: z.number().optional(),
    month_cents: z.number().optional(), deliveries_today: z.number().optional(), deliveries_month: z.number().optional(),
    liberacoes: z.array(z.object({ dia: z.string(), cents: z.number() })).optional(),
  })
  .transform((r) => ({
    todayCents: r.today_cents, weekCents: r.week_cents, totalCents: r.ganho_total_cents ?? r.total_cents ?? 0, deliveries: r.deliveries,
    /** false enquanto o banco não tiver a 0036 (carteira e saques). */
    wallet: r.disponivel_cents !== undefined,
    heldCents: r.guardado_cents ?? 0, availableCents: r.disponivel_cents ?? 0, pendingCents: r.em_saque_cents ?? 0,
    withdrawnCents: r.sacado_cents ?? 0, holdDays: r.dias_guardado ?? 7, releases: r.liberacoes ?? [],
    /** null enquanto o banco não tiver a 0038 (a tela mostra "—", sem inventar) */
    monthCents: r.month_cents ?? null, deliveriesToday: r.deliveries_today ?? null, deliveriesMonth: r.deliveries_month ?? null,
  }))
export type CourierEarnings = z.output<typeof walletSchema>

/** Carteira (0036); cai para os ganhos simples se o banco ainda não tiver a carteira. */
export async function getEarnings(): Promise<CourierEarnings> {
  try {
    return await exec(supabase.rpc('courier_wallet'), walletSchema)
  } catch (e) {
    if (e instanceof RepositoryError && e.detail?.field === 'schema') return exec(supabase.rpc('courier_earnings'), walletSchema)
    throw e
  }
}

export type WithdrawalStatus = 'solicitado' | 'pago' | 'recusado' | 'cancelado'
export const WITHDRAWAL_LABEL: Record<WithdrawalStatus, string> = { solicitado: 'Em análise', pago: 'Pago', recusado: 'Recusado', cancelado: 'Cancelado' }
const withdrawalSchema = z
  .object({ id: z.string(), amount_cents: z.number(), pix_key: z.string(), status: z.enum(['solicitado', 'pago', 'recusado', 'cancelado']),
            requested_at: z.string(), decided_at: z.string().nullable(), note: z.string().nullable() })
  .transform((r) => ({ id: r.id, amountCents: r.amount_cents, pixKey: r.pix_key, status: r.status, requestedAt: r.requested_at, decidedAt: r.decided_at, note: r.note }))
export type Withdrawal = z.output<typeof withdrawalSchema>
export const listWithdrawals = () => exec(supabase.rpc('courier_withdrawals_list'), z.array(withdrawalSchema))
export const requestWithdrawal = (pixKey: string) =>
  exec(supabase.rpc('courier_request_withdrawal', { _pix_key: pixKey.trim() }), z.object({ id: z.string(), amount_cents: z.number() })).then((r) => r.amount_cents)
export const cancelWithdrawal = (id: string) => exec(supabase.rpc('courier_cancel_withdrawal', { _id: id }), z.unknown()).then(() => undefined)

// ---------- entregador próprio (0032): só as entregas atribuídas pelo comércio ----------
const ownSchema = z
  .object({
    order_id: z.string(), order_code: z.string(), order_status: z.string(), business_id: z.string(), business_name: z.string(),
    business_address: z.string().nullable(), business_phone: z.string().nullable(), customer_name: z.string(), customer_phone: z.string(),
    delivery_address: z.string().nullable(), delivery_reference: z.string().nullable(),
    payment_method: z.enum(['cash', 'pix_on_delivery', 'card_on_delivery']), total_cents: z.number().int(), change_for_cents: z.number().int().nullable(),
    created_at: z.string(), updated_at: z.string(),
  })
  .transform((r) => ({
    orderId: r.order_id, code: r.order_code, status: r.order_status, businessId: r.business_id, businessName: r.business_name,
    businessAddress: r.business_address, businessPhone: r.business_phone, customerName: r.customer_name, customerPhone: r.customer_phone,
    address: r.delivery_address, reference: r.delivery_reference, payment: r.payment_method, totalCents: r.total_cents,
    changeForCents: r.change_for_cents, createdAt: r.created_at, updatedAt: r.updated_at,
  }))
export type OwnDelivery = z.output<typeof ownSchema>

export async function ownDeliveries(active: boolean): Promise<OwnDelivery[]> {
  return exec(supabase.rpc('own_courier_deliveries', { _active: active }), z.array(ownSchema))
}
export async function ownDeliveryStatus(orderId: string, status: 'out_for_delivery' | 'delivered'): Promise<void> {
  await exec(supabase.rpc('own_courier_set_status', { _order: orderId, _status: status }), z.unknown())
}
/** Equipe da loja: entregadores próprios e atribuição da entrega. */
export async function listOwnCouriers(businessId: string): Promise<{ userId: string; name: string }[]> {
  return exec(supabase.rpc('merchant_own_couriers', { _business: businessId }), z.array(z.object({ user_id: z.string(), name: z.string() })))
    .then((rows) => rows.map((r) => ({ userId: r.user_id, name: r.name })))
}
export async function assignOwnCourier(orderId: string, courierId: string | null): Promise<void> {
  await exec(supabase.rpc('merchant_assign_own_courier', { _order: orderId, _courier: courierId }), z.unknown())
}
/** Entregador próprio atribuído ao pedido (consulta separada: coluna nova da 0032). */
export async function currentOwnCourier(orderId: string): Promise<string | null> {
  const rows = await exec(supabase.from('orders').select('own_courier_id').eq('id', orderId), z.array(z.object({ own_courier_id: z.string().nullable() })))
  return rows[0]?.own_courier_id ?? null
}
