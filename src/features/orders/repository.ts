import { z } from 'zod'
import { RepositoryError, backendUnavailable, mapPostgrestError } from '../../lib/errors'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import type { Cart } from '../cart/cartStore'
import { DEFAULT_PRICING_CONFIG } from '../pricing/pricing'

/**
 * Pedidos (0011) e acompanhamento da entrega (0012). O navegador envia só ids e quantidades;
 * preços, frete e comissão são calculados no servidor. Mudanças de status só por funções.
 */

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

export const orderStatuses = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'picked_up', 'rejected', 'cancelled'] as const
export type OrderStatus = (typeof orderStatuses)[number]
export const fulfillments = ['delivery_own', 'delivery_partner', 'pickup'] as const
export type Fulfillment = (typeof fulfillments)[number]
export const payments = ['cash', 'pix_on_delivery', 'card_on_delivery'] as const
export type Payment = (typeof payments)[number]

export const STATUS_LABEL: Record<OrderStatus, string> = {
  placed: 'Aguardando o estabelecimento',
  accepted: 'Aceito',
  preparing: 'Em preparo',
  ready: 'Pronto',
  out_for_delivery: 'Saiu para entrega',
  delivered: 'Entregue',
  picked_up: 'Retirado',
  rejected: 'Recusado',
  cancelled: 'Cancelado',
}
export const FULFILLMENT_LABEL: Record<Fulfillment, string> = {
  delivery_own: 'Entrega do estabelecimento',
  delivery_partner: 'Entregador parceiro Tucaí',
  pickup: 'Retirada no local',
}
export const PAYMENT_LABEL: Record<Payment, string> = {
  cash: 'Dinheiro na entrega/retirada',
  pix_on_delivery: 'Pix na entrega/retirada',
  card_on_delivery: 'Cartão na maquininha (entrega/retirada)',
}
export const FINAL_STATUSES: readonly OrderStatus[] = ['delivered', 'picked_up', 'rejected', 'cancelled']
export const isFinal = (s: OrderStatus) => FINAL_STATUSES.includes(s)

/** Próximos passos que a equipe pode dar (espelho das regras do servidor, só para os botões). */
export function staffNextSteps(status: OrderStatus, fulfillment: Fulfillment): OrderStatus[] {
  switch (status) {
    case 'placed':
      return ['accepted', 'rejected']
    case 'accepted':
      return ['preparing', 'cancelled']
    case 'preparing':
      return ['ready', 'cancelled']
    case 'ready':
      if (fulfillment === 'delivery_own') return ['out_for_delivery', 'cancelled']
      if (fulfillment === 'pickup') return ['picked_up', 'cancelled']
      return ['cancelled']
    case 'out_for_delivery':
      return fulfillment === 'delivery_own' ? ['delivered'] : []
    default:
      return []
  }
}

export const STEP_ACTION: Partial<Record<OrderStatus, string>> = {
  accepted: 'Aceitar',
  rejected: 'Recusar',
  preparing: 'Iniciar preparo',
  ready: 'Marcar pronto',
  out_for_delivery: 'Saiu para entrega',
  delivered: 'Marcar entregue',
  picked_up: 'Cliente retirou',
  cancelled: 'Cancelar',
}

/** Taxa de entrega exibida (prévia). O servidor recalcula com a configuração vigente. */
export function previewDeliveryFee(f: Fulfillment, b: { ownDeliveryFeeCents: number }): number {
  if (f === 'delivery_own') return b.ownDeliveryFeeCents
  if (f === 'delivery_partner') return DEFAULT_PRICING_CONFIG.partnerDelivery.customerFeeCents
  return 0
}

// ---------- checkout ----------
export const checkoutSchema = z
  .object({
    fulfillment: z.enum(fulfillments),
    payment: z.enum(payments),
    customerName: z.string().trim().min(2, 'Informe seu nome.').max(120),
    customerPhone: z.string().trim().regex(/^[0-9+() -]{8,20}$/, 'Telefone inválido. Ex.: (35) 99999-0000'),
    address: z.string().trim().max(300),
    reference: z.string().trim().max(200),
    notes: z.string().trim().max(500),
    changeFor: z.string().trim(),
  })
  .superRefine((v, ctx) => {
    if (v.fulfillment !== 'pickup' && v.address.length < 5) ctx.addIssue({ code: 'custom', path: ['address'], message: 'Informe rua, número e bairro.' })
    if (v.changeFor && v.payment !== 'cash') ctx.addIssue({ code: 'custom', path: ['changeFor'], message: 'Troco só para dinheiro.' })
    if (v.changeFor && !/^\d+([.,]\d{1,2})?$/.test(v.changeFor)) ctx.addIssue({ code: 'custom', path: ['changeFor'], message: 'Valor inválido. Ex.: 100' })
  })
export type CheckoutForm = z.input<typeof checkoutSchema>

const toCents = (s: string) => Math.round(Number(s.replace(',', '.')) * 100)

export function newIdempotencyKey(): string {
  return `web-${crypto.randomUUID()}`
}

export function placeOrderArgs(cart: Cart, input: CheckoutForm, idempotencyKey: string) {
  const v = checkoutSchema.parse(input)
  return {
    _business: cart.business.id,
    _items: cart.lines.map((l) => ({ product_id: l.productId, quantity: l.quantity, option_ids: l.optionIds, notes: l.notes || null })),
    _fulfillment: v.fulfillment,
    _payment: v.payment,
    _customer_name: v.customerName,
    _customer_phone: v.customerPhone,
    _delivery_address: v.fulfillment === 'pickup' ? null : v.address,
    _delivery_reference: v.fulfillment === 'pickup' ? null : v.reference || null,
    _notes: v.notes || null,
    _change_for_cents: v.payment === 'cash' && v.changeFor ? toCents(v.changeFor) : null,
    _idempotency_key: idempotencyKey,
  }
}

export async function placeOrder(cart: Cart, input: CheckoutForm, idempotencyKey: string): Promise<string> {
  return exec(supabase.rpc('place_order', placeOrderArgs(cart, input, idempotencyKey)), z.string())
}

// ---------- leitura ----------
const ORDER_COLUMNS =
  'id,code,customer_id,business_id,status,fulfillment,payment_method,change_for_cents,customer_name,customer_phone,delivery_address,delivery_reference,notes,subtotal_cents,delivery_fee_cents,discount_cents,total_cents,commission_cents,merchant_delivery_contribution_cents,platform_delivery_fee_cents,rejection_reason,created_at,updated_at'

const orderSchema = z
  .object({
    id: z.string(), code: z.string(), customer_id: z.string(), business_id: z.string(), status: z.enum(orderStatuses),
    fulfillment: z.enum(fulfillments), payment_method: z.enum(payments), change_for_cents: z.number().int().nullable(),
    customer_name: z.string(), customer_phone: z.string(), delivery_address: z.string().nullable(), delivery_reference: z.string().nullable(),
    notes: z.string().nullable(), subtotal_cents: z.number().int(), delivery_fee_cents: z.number().int(), discount_cents: z.number().int(),
    total_cents: z.number().int(), commission_cents: z.number().int(), merchant_delivery_contribution_cents: z.number().int(),
    platform_delivery_fee_cents: z.number().int(), rejection_reason: z.string().nullable(), created_at: z.string(), updated_at: z.string(),
  })
  .transform((r) => ({
    id: r.id, code: r.code, customerId: r.customer_id, businessId: r.business_id, status: r.status, fulfillment: r.fulfillment,
    payment: r.payment_method, changeForCents: r.change_for_cents, customerName: r.customer_name, customerPhone: r.customer_phone,
    address: r.delivery_address, reference: r.delivery_reference, notes: r.notes, subtotalCents: r.subtotal_cents,
    deliveryFeeCents: r.delivery_fee_cents, discountCents: r.discount_cents, totalCents: r.total_cents, commissionCents: r.commission_cents,
    merchantDeliveryCents: r.merchant_delivery_contribution_cents + r.platform_delivery_fee_cents, rejectionReason: r.rejection_reason,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }))
export type Order = z.output<typeof orderSchema>

const itemSchema = z
  .object({
    id: z.string(), order_id: z.string(), name: z.string(), unit_price_cents: z.number().int(), quantity: z.number().int(),
    options: z.array(z.object({ group: z.string(), option: z.string(), price_delta_cents: z.number().int() })),
    line_total_cents: z.number().int(), notes: z.string().nullable(),
  })
  .transform((r) => ({
    id: r.id, orderId: r.order_id, name: r.name, unitCents: r.unit_price_cents, quantity: r.quantity,
    options: r.options.map((o) => o.option), lineTotalCents: r.line_total_cents, notes: r.notes,
  }))
export type OrderItem = z.output<typeof itemSchema>

const eventSchema = z
  .object({ id: z.number(), status: z.enum(orderStatuses), note: z.string().nullable(), created_at: z.string() })
  .transform((r) => ({ id: r.id, status: r.status, note: r.note, createdAt: r.created_at }))
export type OrderEvent = z.output<typeof eventSchema>

const businessNameSchema = z.object({ id: z.string(), name: z.string(), slug: z.string(), phone: z.string().nullable(), whatsapp: z.string().nullable(), address_line: z.string().nullable() })
export type OrderBusiness = { id: string; name: string; slug: string; phone: string | null; whatsapp: string | null; addressLine: string | null }

async function businessesByIds(ids: string[]): Promise<Map<string, OrderBusiness>> {
  if (ids.length === 0) return new Map()
  const rows = await exec(
    supabase.from('public_businesses').select('id,name,slug,phone,whatsapp,address_line').in('id', [...new Set(ids)]),
    z.array(businessNameSchema),
  )
  return new Map(rows.map((b) => [b.id, { id: b.id, name: b.name, slug: b.slug, phone: b.phone, whatsapp: b.whatsapp, addressLine: b.address_line }]))
}

export type OrderWithBusiness = Order & { business: OrderBusiness | null }

export async function listMyOrders(userId: string): Promise<OrderWithBusiness[]> {
  const orders = await exec(
    supabase.from('orders').select(ORDER_COLUMNS).eq('customer_id', userId).order('created_at', { ascending: false }).limit(50),
    z.array(orderSchema),
  )
  const biz = await businessesByIds(orders.map((o) => o.businessId))
  return orders.map((o) => ({ ...o, business: biz.get(o.businessId) ?? null }))
}

export interface OrderDetail {
  order: Order
  business: OrderBusiness | null
  items: OrderItem[]
  events: OrderEvent[]
}

export async function getOrder(id: string): Promise<OrderDetail | null> {
  const order = await exec(supabase.from('orders').select(ORDER_COLUMNS).eq('id', id).maybeSingle(), orderSchema.nullable())
  if (!order) return null
  const [items, events, biz] = await Promise.all([
    exec(supabase.from('order_items').select('id,order_id,name,unit_price_cents,quantity,options,line_total_cents,notes').eq('order_id', id), z.array(itemSchema)),
    exec(supabase.from('order_events').select('id,status,note,created_at').eq('order_id', id).order('created_at', { ascending: true }), z.array(eventSchema)),
    businessesByIds([order.businessId]),
  ])
  return { order, business: biz.get(order.businessId) ?? null, items, events }
}

export async function updateOrderStatus(id: string, status: OrderStatus, note = ''): Promise<OrderStatus> {
  return exec(supabase.rpc('update_order_status', { _order: id, _status: status, _note: note.trim() || null }), z.enum(orderStatuses))
}

// ---------- entrega (cliente) ----------
export const deliveryStatuses = ['offered', 'accepted', 'picked_up', 'delivered', 'cancelled'] as const
export type DeliveryStatus = (typeof deliveryStatuses)[number]
const myDeliverySchema = z
  .object({ status: z.enum(deliveryStatuses), confirmation_code: z.string().nullable(), courier_first_name: z.string().nullable(), courier_vehicle: z.string().nullable() })
  .transform((r) => ({ status: r.status, code: r.confirmation_code, courierName: r.courier_first_name, vehicle: r.courier_vehicle }))
export type MyDelivery = z.output<typeof myDeliverySchema>

export async function getMyDelivery(orderId: string): Promise<MyDelivery | null> {
  const rows = await exec(supabase.rpc('my_delivery', { _order: orderId }), z.array(myDeliverySchema))
  return rows[0] ?? null
}

// ---------- avaliação ----------
export const reviewFormSchema = z.object({
  rating: z.number().int().min(1, 'Escolha de 1 a 5 estrelas.').max(5),
  comment: z.string().trim().max(1000, 'Até 1000 caracteres.'),
})

export async function submitReview(orderId: string, rating: number, comment: string): Promise<string> {
  const v = reviewFormSchema.parse({ rating, comment })
  return exec(supabase.rpc('submit_review', { _order: orderId, _rating: v.rating, _comment: v.comment || null }), z.string())
}

const myReviewSchema = z.object({ rating: z.number().int(), comment: z.string().nullable(), reply: z.string().nullable() })
export async function getMyOrderReview(orderId: string): Promise<z.infer<typeof myReviewSchema> | null> {
  const rows = await exec(supabase.rpc('my_order_review', { _order: orderId }), z.array(myReviewSchema))
  return rows[0] ?? null
}

// ---------- painel do estabelecimento ----------
export async function listBusinessOrders(businessId: string, scope: 'open' | 'done'): Promise<Order[]> {
  let q = supabase.from('orders').select(ORDER_COLUMNS).eq('business_id', businessId)
  q = scope === 'open'
    ? q.in('status', ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery']).order('created_at', { ascending: true })
    : q.in('status', [...FINAL_STATUSES]).order('created_at', { ascending: false })
  return exec(q.limit(100), z.array(orderSchema))
}

export async function listOrderItems(orderIds: string[]): Promise<OrderItem[]> {
  if (orderIds.length === 0) return []
  return exec(
    supabase.from('order_items').select('id,order_id,name,unit_price_cents,quantity,options,line_total_cents,notes').in('order_id', orderIds),
    z.array(itemSchema),
  )
}

const deliveryRowSchema = z
  .object({ order_id: z.string(), status: z.enum(deliveryStatuses), courier_id: z.string().nullable() })
  .transform((r) => ({ orderId: r.order_id, status: r.status, hasCourier: !!r.courier_id }))
export async function listBusinessDeliveries(orderIds: string[]): Promise<z.output<typeof deliveryRowSchema>[]> {
  if (orderIds.length === 0) return []
  return exec(supabase.from('deliveries').select('order_id,status,courier_id').in('order_id', orderIds), z.array(deliveryRowSchema))
}

const summarySchema = z
  .object({
    orders_total: z.number(), orders_completed: z.number(), orders_cancelled: z.number(), gross_cents: z.number(),
    commission_cents: z.number(), delivery_costs_cents: z.number(),
    top_products: z.array(z.object({ name: z.string(), qty: z.number(), total_cents: z.number() })),
  })
  .transform((r) => ({
    ordersTotal: r.orders_total, ordersCompleted: r.orders_completed, ordersCancelled: r.orders_cancelled, grossCents: r.gross_cents,
    commissionCents: r.commission_cents, deliveryCostsCents: r.delivery_costs_cents,
    netCents: r.gross_cents - r.commission_cents - r.delivery_costs_cents,
    topProducts: r.top_products.map((t) => ({ name: t.name, qty: t.qty, totalCents: t.total_cents })),
  }))
export type SalesSummary = z.output<typeof summarySchema>

export async function getSalesSummary(businessId: string, days: number): Promise<SalesSummary> {
  return exec(supabase.rpc('business_sales_summary', { _business: businessId, _days: days }), summarySchema)
}

const businessReviewSchema = z
  .object({ id: z.string(), rating: z.number().int(), comment: z.string().nullable(), author_name: z.string().nullable(), created_at: z.string(), reply: z.string().nullable() })
  .transform((r) => ({ id: r.id, rating: r.rating, comment: r.comment, authorName: r.author_name, createdAt: r.created_at, reply: r.reply }))
export type BusinessReview = z.output<typeof businessReviewSchema>

export async function listBusinessReviews(businessId: string): Promise<BusinessReview[]> {
  return exec(
    supabase.from('reviews').select('id,rating,comment,author_name,created_at,reply').eq('business_id', businessId).order('created_at', { ascending: false }).limit(50),
    z.array(businessReviewSchema),
  )
}

export async function replyReview(reviewId: string, reply: string): Promise<void> {
  await exec(supabase.rpc('reply_review', { _review: reviewId, _reply: reply.trim() }), z.unknown())
}
