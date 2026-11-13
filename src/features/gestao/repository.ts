import { z } from 'zod'
import { RepositoryError, backendUnavailable, mapPostgrestError } from '../../lib/errors'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'

/**
 * Tucaí Gestão (0026/0027): plano, visão geral, equipe, calculadora, mesas, comandas, cozinha e caixa.
 * Toda regra (permissão, plano Premium, preços, totais, concorrência) é decidida no banco.
 */
type Res = { data: unknown; error: { code?: string; message: string } | null }
async function rpc<T>(fn: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  let res: Res
  try {
    res = (await supabase.rpc(fn, args)) as Res
  } catch (e) {
    throw mapPostgrestError({ message: e instanceof Error ? e.message : String(e) })
  }
  if (res.error) throw mapPostgrestError(res.error)
  const parsed = schema.safeParse(res.data)
  if (!parsed.success) throw new RepositoryError('validation', 'Recebemos dados inesperados do servidor.', undefined, { cause: parsed.error })
  return parsed.data
}
const n = z.number()

// ---------- plano ----------
const planSchema = z.object({ plan_code: z.string().nullable(), plan_name: z.string().nullable(), premium: z.boolean(), source: z.string().nullable(), period_end: z.string().nullable() })
  .transform((r) => ({ code: r.plan_code, name: r.plan_name, premium: r.premium, source: r.source as 'assinatura' | 'homologacao' | null, periodEnd: r.period_end }))
export type BusinessPlan = z.output<typeof planSchema>
export const getBusinessPlan = (businessId: string) => rpc('business_plan', { _business: businessId }, planSchema)
export const requestPlanChange = (businessId: string, plan: 'delivery' | 'presencial_delivery') =>
  rpc('merchant_request_plan_change', { _business: businessId, _plan: plan }, z.any()).then(() => undefined)

// ---------- visão geral ----------
const overviewSchema = z.object({
  premium: z.boolean(), recebidos_hoje: n, concluidos_hoje: n, cancelados_hoje: n, em_andamento: n, faturamento_hoje_cents: n,
  faturamento_mes_cents: n, ticket_medio_cents: n, recebido_mes_cents: n, pendente_cents: n, taxas_mes_cents: n,
  despesas_mes_cents: n.nullable(), serie: z.array(z.object({ dia: z.string(), cents: n })),
})
export type Overview = z.infer<typeof overviewSchema>
export const getOverview = (businessId: string) => rpc('merchant_overview', { _business: businessId }, overviewSchema)

// ---------- equipe ----------
export type MemberRole = 'owner' | 'manager' | 'attendant' | 'kitchen' | 'courier_own'
export const MEMBER_ROLE_LABEL: Record<MemberRole, string> = {
  owner: 'Empresário', manager: 'Gerente', attendant: 'Funcionário (atendimento e cozinha)', kitchen: 'Cozinha (cargo antigo)', courier_own: 'Entregador próprio',
}
const teamSchema = z.object({ user_id: z.string().nullable(), name: z.string().nullable(), email: z.string().nullable(), member_role: z.string(), pending: z.boolean(), invite_id: z.string().nullable(), created_at: z.string() })
  .transform((r) => ({ userId: r.user_id, name: r.name, email: r.email, role: r.member_role as MemberRole, pending: r.pending, inviteId: r.invite_id, createdAt: r.created_at }))
export type TeamMember = z.output<typeof teamSchema>
export const listTeam = (businessId: string) => rpc('merchant_team', { _business: businessId }, z.array(teamSchema))
export const inviteMember = (businessId: string, email: string, role: Exclude<MemberRole, 'owner'>) =>
  rpc('merchant_invite_member', { _business: businessId, _email: email.trim(), _role: role }, z.enum(['vinculado', 'convidado']))
export const setMemberRole = (businessId: string, userId: string, role: Exclude<MemberRole, 'owner'>) =>
  rpc('merchant_set_member_role', { _business: businessId, _user: userId, _role: role }, z.any()).then(() => undefined)
export const removeMember = (businessId: string, userId: string | null, inviteId: string | null = null) =>
  rpc('merchant_remove_member', { _business: businessId, _user: userId, _invite: inviteId }, z.any()).then(() => undefined)
export const setMemberPermission = (businessId: string, userId: string, permission: 'tabs.manage' | 'cash.manage' | 'reports.view', granted: boolean) =>
  rpc('merchant_set_member_permission', { _business: businessId, _user: userId, _permission: permission, _granted: granted }, z.any()).then(() => undefined)
export async function listMemberExtras(businessId: string): Promise<{ userId: string; permission: string }[]> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  const { data, error } = await supabase.from('business_member_permissions').select('user_id,permission').eq('business_id', businessId)
  if (error) throw mapPostgrestError(error)
  return (data ?? []).map((r) => ({ userId: r.user_id as string, permission: r.permission as string }))
}

// ---------- calculadora (Premium) ----------
const costingSchema = z.object({
  product_id: z.string(), name: z.string(), price_cents: n, recipe_cents: n.nullable(), manual_cents: n.nullable(), packaging_cents: n,
  operational_cents: n, unit_cost_cents: n, fee_cents: n, margin_cents: n, margin_bps: n, target_margin_bps: n,
  suggested_price_cents: n.nullable(), has_cost: z.boolean(), ingredients: n,
}).transform((r) => ({
  productId: r.product_id, name: r.name, priceCents: r.price_cents, recipeCents: r.recipe_cents, manualCents: r.manual_cents,
  packagingCents: r.packaging_cents, operationalCents: r.operational_cents, unitCostCents: r.unit_cost_cents, feeCents: r.fee_cents,
  marginCents: r.margin_cents, marginBps: r.margin_bps, targetMarginBps: r.target_margin_bps, suggestedCents: r.suggested_price_cents,
  hasCost: r.has_cost, ingredients: r.ingredients,
}))
export type Costing = z.output<typeof costingSchema>
export const listCosting = (businessId: string) => rpc('merchant_costing', { _business: businessId }, z.array(costingSchema))
export const saveCostingSnapshot = (businessId: string, productId: string) =>
  rpc('merchant_save_costing_snapshot', { _business: businessId, _product: productId }, z.string())

export interface Ingredient { id: string; name: string; unit: 'un' | 'kg' | 'g' | 'l' | 'ml'; purchaseCostCents: number; purchaseQty: number }
export async function listIngredients(businessId: string): Promise<Ingredient[]> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  const { data, error } = await supabase.from('business_ingredients').select('id,name,unit,purchase_cost_cents,purchase_qty').eq('business_id', businessId).order('name')
  if (error) throw mapPostgrestError(error)
  return (data ?? []).map((r) => ({ id: r.id as string, name: r.name as string, unit: r.unit as Ingredient['unit'], purchaseCostCents: r.purchase_cost_cents as number, purchaseQty: Number(r.purchase_qty) }))
}
export async function addIngredient(businessId: string, i: Omit<Ingredient, 'id'>): Promise<void> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  const { error } = await supabase.from('business_ingredients').insert({ business_id: businessId, name: i.name.trim(), unit: i.unit, purchase_cost_cents: i.purchaseCostCents, purchase_qty: i.purchaseQty })
  if (error) throw mapPostgrestError(error)
}
export async function deleteIngredient(id: string): Promise<void> {
  const { error } = await supabase.from('business_ingredients').delete().eq('id', id)
  if (error) throw mapPostgrestError(error)
}
export async function listRecipe(productId: string): Promise<{ ingredientId: string; quantity: number }[]> {
  const { data, error } = await supabase.from('product_recipe_items').select('ingredient_id,quantity').eq('product_id', productId)
  if (error) throw mapPostgrestError(error)
  return (data ?? []).map((r) => ({ ingredientId: r.ingredient_id as string, quantity: Number(r.quantity) }))
}
export async function setRecipeItem(businessId: string, productId: string, ingredientId: string, quantity: number | null): Promise<void> {
  if (quantity === null || quantity <= 0) {
    const { error } = await supabase.from('product_recipe_items').delete().eq('product_id', productId).eq('ingredient_id', ingredientId)
    if (error) throw mapPostgrestError(error)
    return
  }
  const { error } = await supabase.from('product_recipe_items').upsert({ product_id: productId, ingredient_id: ingredientId, business_id: businessId, quantity })
  if (error) throw mapPostgrestError(error)
}
export async function setProductExtras(businessId: string, productId: string, v: { packagingCents: number; operationalCents: number; targetMarginBps: number }): Promise<void> {
  const { error } = await supabase.from('business_product_costs').upsert({
    product_id: productId, business_id: businessId, packaging_cents: v.packagingCents, operational_cents: v.operationalCents,
    target_margin_bps: v.targetMarginBps, updated_at: new Date().toISOString(),
  })
  if (error) throw mapPostgrestError(error)
}

// ---------- mesas e comandas (Premium) ----------
export type Situation = 'livre' | 'ocupada' | 'em_preparo' | 'pronto' | 'aguardando_pagamento'
const boardSchema = z.object({
  table_id: z.string().nullable(), table_name: z.string().nullable(), area: z.string().nullable(), capacity: n.nullable(),
  tab_id: z.string().nullable(), tab_number: n.nullable(), tab_label: z.string().nullable(), people: n.nullable(), tab_status: z.string().nullable(),
  situation: z.enum(['livre', 'ocupada', 'em_preparo', 'pronto', 'aguardando_pagamento']), opened_at: z.string().nullable(),
  last_activity_at: z.string().nullable(), opened_by_name: z.string().nullable(), total_cents: n, items_count: n, pending_kitchen: n, ready_items: n,
}).transform((r) => ({
  tableId: r.table_id, tableName: r.table_name, area: r.area, capacity: r.capacity, tabId: r.tab_id, tabNumber: r.tab_number,
  tabLabel: r.tab_label, people: r.people, situation: r.situation, openedAt: r.opened_at, lastActivityAt: r.last_activity_at,
  openedBy: r.opened_by_name, totalCents: r.total_cents, itemsCount: r.items_count, pendingKitchen: r.pending_kitchen, readyItems: r.ready_items,
}))
export type BoardCard = z.output<typeof boardSchema>
export const getBoard = (businessId: string) => rpc('gestao_board', { _business: businessId }, z.array(boardSchema))
export const createTables = (businessId: string, count: number, area: string, capacity: number) =>
  rpc('gestao_create_tables', { _business: businessId, _count: count, _area: area || null, _capacity: capacity }, n)
export const saveTable = (businessId: string, id: string | null, name: string, area: string, capacity: number | null, active = true) =>
  rpc('gestao_save_table', { _business: businessId, _id: id, _name: name, _area: area || null, _capacity: capacity, _active: active }, z.string())
export const openTab = (businessId: string, tableId: string | null, label: string, people: number | null) =>
  rpc('gestao_open_tab', { _business: businessId, _table: tableId, _label: label || null, _people: people }, z.string())
export const addTabItems = (tabId: string, items: { productId: string; quantity: number; notes?: string }[], opId: string) =>
  rpc('gestao_add_items', { _tab: tabId, _items: items.map((i) => ({ product_id: i.productId, quantity: i.quantity, notes: i.notes ?? null })), _op: opId }, n)
export const setItemStatus = (itemId: string, status: 'em_preparo' | 'pronto' | 'servido') =>
  rpc('gestao_item_status', { _item: itemId, _status: status }, z.any()).then(() => undefined)
export const cancelTabItem = (itemId: string, reason: string) => rpc('gestao_cancel_item', { _item: itemId, _reason: reason }, z.any()).then(() => undefined)
export const transferTab = (tabId: string, tableId: string) => rpc('gestao_transfer_tab', { _tab: tabId, _table: tableId }, z.any()).then(() => undefined)
export const requestClose = (tabId: string) => rpc('gestao_request_close', { _tab: tabId }, z.any()).then(() => undefined)
export type PayMethod = 'dinheiro' | 'pix' | 'cartao' | 'outro'
export const closeTab = (tabId: string, payments: { method: PayMethod; amountCents: number }[], discountCents: number, opId: string) =>
  rpc('gestao_close_tab', { _tab: tabId, _payments: payments.map((p) => ({ method: p.method, amount_cents: p.amountCents })), _discount_cents: discountCents, _op: opId },
    z.object({ status: z.string() }).passthrough())
export const cancelTab = (tabId: string, reason: string) => rpc('gestao_cancel_tab', { _tab: tabId, _reason: reason }, z.any()).then(() => undefined)

export interface TabItem { id: string; name: string; quantity: number; unitCents: number; notes: string | null; status: string; createdAt: string }
export async function listTabItems(tabId: string): Promise<TabItem[]> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  const { data, error } = await supabase.from('business_tab_items').select('id,name,quantity,unit_price_cents,notes,kitchen_status,created_at').eq('tab_id', tabId).order('created_at')
  if (error) throw mapPostgrestError(error)
  return (data ?? []).map((r) => ({ id: r.id as string, name: r.name as string, quantity: r.quantity as number, unitCents: r.unit_price_cents as number,
    notes: (r.notes as string | null) ?? null, status: r.kitchen_status as string, createdAt: r.created_at as string }))
}
export async function listTables(businessId: string): Promise<{ id: string; name: string; area: string | null; capacity: number | null; qrToken: string; active: boolean }[]> {
  const { data, error } = await supabase.from('business_tables').select('id,name,area,capacity,qr_token,is_active').eq('business_id', businessId).order('sort_order')
  if (error) throw mapPostgrestError(error)
  return (data ?? []).map((r) => ({ id: r.id as string, name: r.name as string, area: (r.area as string | null) ?? null, capacity: (r.capacity as number | null) ?? null, qrToken: r.qr_token as string, active: r.is_active as boolean }))
}

// ---------- cozinha ----------
const kitchenSchema = z.object({ origin: z.enum(['delivery', 'retirada', 'mesa', 'balcao']), ref_id: z.string(), ref_label: z.string(), item_id: z.string(),
  item_name: z.string(), quantity: n, notes: z.string().nullable(), status: z.string(), created_at: z.string() })
  .transform((r) => ({ origin: r.origin, refId: r.ref_id, refLabel: r.ref_label, itemId: r.item_id, itemName: r.item_name, quantity: r.quantity, notes: r.notes, status: r.status, createdAt: r.created_at }))
export type KitchenLine = z.output<typeof kitchenSchema>
export const getKitchen = (businessId: string) => rpc('gestao_kitchen', { _business: businessId }, z.array(kitchenSchema))

// ---------- caixa (Premium) ----------
const cashStatusSchema = z.object({ open: z.boolean(), session_id: z.string().optional(), opened_at: z.string().optional(), opened_by: z.string().nullable().optional() })
export const getCashStatus = (businessId: string) => rpc('gestao_cash_status', { _business: businessId }, cashStatusSchema)
export const openCash = (businessId: string, openingCents: number) => rpc('gestao_open_cash', { _business: businessId, _opening_cents: openingCents }, z.string())
export type CashKind = 'venda' | 'entrada' | 'saida' | 'sangria' | 'suprimento'
export const cashMovement = (businessId: string, kind: CashKind, method: PayMethod, amountCents: number, description: string, opId: string) =>
  rpc('gestao_cash_movement', { _business: businessId, _kind: kind, _method: method, _amount_cents: amountCents, _description: description || null, _op: opId }, z.string())
const reportSchema = z.object({
  id: z.string(), status: z.string(), opened_at: z.string(), closed_at: z.string().nullable(), opening_cents: n, opened_by: z.string().nullable(),
  closed_by: z.string().nullable(), expected_cash_cents: n, counted_cents: n.nullable(), difference_cents: n.nullable(),
  by_kind: z.record(z.string(), n), by_method: z.record(z.string(), n),
  movements: z.array(z.object({ kind: z.string(), method: z.string(), amount_cents: n, description: z.string().nullable(), confirmation: z.string(), at: z.string(), by: z.string().nullable() })),
})
export type CashReport = z.infer<typeof reportSchema>
export const getCashReport = (sessionId: string) => rpc('gestao_cash_report', { _session: sessionId }, reportSchema)
export const closeCash = (businessId: string, countedCents: number, notes: string) => rpc('gestao_close_cash', { _business: businessId, _counted_cents: countedCents, _notes: notes || null }, reportSchema)

// ---------- QR da mesa (público) ----------
export async function tableByQr(token: string): Promise<{ businessSlug: string; businessName: string; businessType: string; tableName: string } | null> {
  if (!isSupabaseConfigured) return null
  const { data, error } = await supabase.rpc('table_by_qr', { _token: token })
  if (error) throw mapPostgrestError(error)
  const r = (data as { business_slug: string; business_name: string; business_type: string; table_name: string }[] | null)?.[0]
  return r ? { businessSlug: r.business_slug, businessName: r.business_name, businessType: r.business_type, tableName: r.table_name } : null
}

/** Identificador de operação (repetir a mesma ação não duplica no banco). */
export const newOpId = () => globalThis.crypto.randomUUID()

// ---------- início simplificado: dinheiro do mês a partir dos pedidos concluídos (dados reais, mesmas regras do banco) ----------
const monthOrderSchema = z.object({
  fulfillment: z.enum(['delivery_own', 'delivery_partner', 'pickup']), subtotal_cents: z.number(), delivery_fee_cents: z.number(), total_cents: z.number(),
  commission_cents: z.number(), merchant_delivery_contribution_cents: z.number(), platform_delivery_fee_cents: z.number(),
})
export interface MonthMoney {
  /** pedidos concluídos (entregues ou retirados) no mês */
  orders: number
  /** entregas feitas (própria + entregador parceiro) no mês */
  deliveries: number
  partnerDeliveries: number
  ownDeliveries: number
  /** o que entrou para a loja: produtos + taxa de entrega própria */
  receivedCents: number
  commissionCents: number
  /** pedidos em que houve comissão e a soma dos produtos desses pedidos (para explicar a taxa com dados reais) */
  commissionOrders: number
  commissionBaseCents: number
  partnerFeesCents: number
  ownFeesCents: number
  /** frete pago pelos clientes nas entregas parceiras: a loja recebe (do entregador) e repassa à Tucaí, que paga o entregador */
  partnerCustomerFeesCents: number
  /** contribuição por entrega parceira + tarifa por entrega própria (nunca as duas somadas) */
  deliveryFeesCents: number
}
export async function getMonthMoney(businessId: string): Promise<MonthMoney> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  const start = new Date()
  start.setDate(1); start.setHours(0, 0, 0, 0)
  const { data, error } = await supabase.from('orders')
    .select('fulfillment,subtotal_cents,delivery_fee_cents,total_cents,commission_cents,merchant_delivery_contribution_cents,platform_delivery_fee_cents')
    .eq('business_id', businessId).in('status', ['delivered', 'picked_up']).gte('updated_at', start.toISOString()).limit(5000)
  if (error) throw mapPostgrestError(error)
  const rows = z.array(monthOrderSchema).parse(data ?? [])
  const m: MonthMoney = { orders: rows.length, deliveries: 0, partnerDeliveries: 0, ownDeliveries: 0, receivedCents: 0, commissionCents: 0, commissionOrders: 0, commissionBaseCents: 0, partnerFeesCents: 0, ownFeesCents: 0, partnerCustomerFeesCents: 0, deliveryFeesCents: 0 }
  for (const r of rows) {
    m.receivedCents += r.subtotal_cents + (r.fulfillment === 'delivery_own' ? r.delivery_fee_cents : 0)
    m.commissionCents += r.commission_cents
    if (r.commission_cents > 0) { m.commissionOrders++; m.commissionBaseCents += r.subtotal_cents }
    if (r.fulfillment === 'delivery_partner') { m.deliveries++; m.partnerDeliveries++; m.partnerFeesCents += r.merchant_delivery_contribution_cents; m.partnerCustomerFeesCents += r.delivery_fee_cents }
    if (r.fulfillment === 'delivery_own') { m.deliveries++; m.ownDeliveries++; m.ownFeesCents += r.platform_delivery_fee_cents }
  }
  m.deliveryFeesCents = m.partnerFeesCents + m.ownFeesCents
  return m
}

// ---------- frete grátis da loja (0040) ----------
/** null quando o banco ainda não tem a 0040 (o controle fica escondido). */
export async function getFreeDelivery(businessId: string): Promise<boolean | null> {
  if (!isSupabaseConfigured) return null
  const { data, error } = await supabase.from('businesses').select('free_delivery').eq('id', businessId).maybeSingle()
  if (error || !data) return null
  return !!(data as { free_delivery?: boolean }).free_delivery
}
export const setFreeDelivery = (businessId: string, on: boolean) =>
  rpc('merchant_set_free_delivery', { _business: businessId, _on: on }, z.unknown()).then(() => undefined)

// ---------- local da loja no mapa (0041): base do frete por distância e do mapa do rastreamento ----------
const locationSchema = z.object({ lat: z.coerce.number().nullable(), lng: z.coerce.number().nullable(), address: z.string().nullable() })
export type StoreLocation = z.infer<typeof locationSchema>
export const getStoreLocation = (businessId: string) => rpc('merchant_location', { _business: businessId }, locationSchema)
export const setStoreLocation = (businessId: string, lat: number | null, lng: number | null) =>
  rpc('merchant_set_location', { _business: businessId, _lat: lat, _lng: lng }, z.unknown()).then(() => undefined)
