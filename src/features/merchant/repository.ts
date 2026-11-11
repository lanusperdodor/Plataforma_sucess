import { z } from 'zod'
import { RepositoryError, backendUnavailable, mapPostgrestError } from '../../lib/errors'
import { parseBRL } from '../../lib/money'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'

/**
 * Painel do estabelecimento (0007). A autorização é da RLS por permissão do membro;
 * aqui validamos formato e mostramos o erro do servidor quando a escrita é recusada.
 */

type Res = { data: unknown; error: { code?: string; message: string } | null; count?: number | null }

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

/** Escrita que deveria afetar uma linha: 0 linhas = sem permissão (RLS filtrou). */
function one<T>(rows: T[]): T {
  const row = rows[0]
  if (!row) throw new RepositoryError('forbidden', 'Você não tem permissão para esta ação neste estabelecimento.')
  return row
}

// ---------- estabelecimento ----------
const businessSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    status: z.enum(['pending', 'active', 'suspended', 'rejected']),
    business_type: z.enum(['restaurante', 'loja', 'servico']),
    category_id: z.string().nullable(),
    description: z.string().nullable(),
    phone: z.string().nullable(),
    whatsapp: z.string().nullable(),
    address_line: z.string().nullable(),
    cover_url: z.string().nullable(),
    logo_url: z.string().nullable(),
    delivery_offer: z.enum(['partner', 'own', 'none']),
    own_delivery_fee_cents: z.number().int(),
    delivery_radius_km: z.number().nullish(),
    accepts_pickup: z.boolean(),
    estimated_min_minutes: z.number().nullable(),
    estimated_max_minutes: z.number().nullable(),
    min_order_cents: z.number().int(),
    review_note: z.string().nullable(),
  })
  .transform((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    businessType: r.business_type,
    categoryId: r.category_id,
    description: r.description,
    phone: r.phone,
    whatsapp: r.whatsapp,
    addressLine: r.address_line,
    coverUrl: r.cover_url,
    logoUrl: r.logo_url,
    deliveryOffer: r.delivery_offer,
    ownDeliveryFeeCents: r.own_delivery_fee_cents,
    /** Área efetiva de entrega a partir do endereço da loja (km). Não é o raio regional de descoberta. */
    deliveryRadiusKm: r.delivery_radius_km ?? null,
    acceptsPickup: r.accepts_pickup,
    estimatedMinMinutes: r.estimated_min_minutes,
    estimatedMaxMinutes: r.estimated_max_minutes,
    minOrderCents: r.min_order_cents,
    reviewNote: r.review_note,
  }))
export type MerchantBusiness = z.output<typeof businessSchema>

const BUSINESS_COLS =
  'id,name,slug,status,business_type,category_id,description,phone,whatsapp,address_line,cover_url,logo_url,' +
  'delivery_offer,own_delivery_fee_cents,delivery_radius_km,accepts_pickup,estimated_min_minutes,estimated_max_minutes,min_order_cents,review_note'

/** Negócios dos quais o usuário é membro (consulta o vínculo no banco, não o cache da sessão). */
export async function listMyBusinesses(userId: string): Promise<MerchantBusiness[]> {
  const links = await exec(supabase.from('business_members').select('business_id').eq('user_id', userId), z.array(z.object({ business_id: z.string() })))
  if (links.length === 0) return []
  return exec(supabase.from('businesses').select(BUSINESS_COLS).in('id', links.map((l) => l.business_id)).order('name'), z.array(businessSchema))
}

export async function getBusiness(id: string): Promise<MerchantBusiness | null> {
  return exec(supabase.from('businesses').select(BUSINESS_COLS).eq('id', id).maybeSingle(), businessSchema.nullable())
}

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^https:\/\/[^\s<>"']+$/.test(v), 'Use um endereço que comece com https://')
const optionalMinutes = z
  .string()
  .trim()
  .refine((v) => v === '' || (/^\d{1,3}$/.test(v) && Number(v) > 0), 'Minutos inválidos')

export const storeFormSchema = z
  .object({
    description: z.string().trim().max(1000, 'Máximo de 1000 caracteres.'),
    phone: z.string().trim().refine((v) => v === '' || /^[0-9+() -]{8,20}$/.test(v), 'Telefone inválido'),
    whatsapp: z.string().trim().refine((v) => v === '' || /^[0-9+() -]{8,20}$/.test(v), 'WhatsApp inválido'),
    addressLine: z.string().trim().max(200),
    coverUrl: httpsUrl,
    logoUrl: httpsUrl,
    categoryId: z.string(),
    deliveryOffer: z.enum(['partner', 'own', 'none']),
    ownDeliveryFee: z.string().trim(),
    deliveryRadius: z
      .string()
      .trim()
      .optional()
      .default('')
      .refine((v) => v === '' || (/^\d{1,3}([.,]\d)?$/.test(v) && Number(v.replace(',', '.')) > 0 && Number(v.replace(',', '.')) <= 100), 'Raio de entrega: de 0,1 a 100 km.'),
    acceptsPickup: z.boolean(),
    minOrder: z.string().trim(),
    estimatedMin: optionalMinutes,
    estimatedMax: optionalMinutes,
  })
  .superRefine((v, ctx) => {
    for (const [k, label] of [['ownDeliveryFee', 'Taxa'], ['minOrder', 'Pedido mínimo']] as const) {
      if (v[k] === '') continue
      try {
        parseBRL(v[k])
      } catch {
        ctx.addIssue({ code: 'custom', path: [k], message: `${label}: valor inválido. Ex.: 5,00` })
      }
    }
    if (v.estimatedMin && v.estimatedMax && Number(v.estimatedMax) < Number(v.estimatedMin)) {
      ctx.addIssue({ code: 'custom', path: ['estimatedMax'], message: 'O máximo deve ser maior que o mínimo.' })
    }
    if (v.deliveryOffer === 'none' && !v.acceptsPickup) {
      ctx.addIssue({ code: 'custom', path: ['acceptsPickup'], message: 'Ofereça entrega ou retirada.' })
    }
  })
export type StoreForm = z.input<typeof storeFormSchema>

const nul = (v: string) => (v.trim() === '' ? null : v.trim())

export function storeFormToPatch(input: StoreForm) {
  const v = storeFormSchema.parse(input)
  return {
    description: nul(v.description),
    phone: nul(v.phone),
    whatsapp: nul(v.whatsapp),
    address_line: nul(v.addressLine),
    cover_url: nul(v.coverUrl),
    logo_url: nul(v.logoUrl),
    category_id: nul(v.categoryId),
    delivery_offer: v.deliveryOffer,
    own_delivery_fee_cents: v.deliveryOffer === 'own' && v.ownDeliveryFee ? parseBRL(v.ownDeliveryFee) : 0,
    delivery_radius_km: v.deliveryOffer === 'own' && v.deliveryRadius ? Number(v.deliveryRadius.replace(',', '.')) : null,
    accepts_pickup: v.acceptsPickup,
    min_order_cents: v.minOrder ? parseBRL(v.minOrder) : 0,
    estimated_min_minutes: v.estimatedMin ? Number(v.estimatedMin) : null,
    estimated_max_minutes: v.estimatedMax ? Number(v.estimatedMax) : null,
  }
}

export async function updateStore(id: string, input: StoreForm): Promise<void> {
  one(await exec(supabase.from('businesses').update(storeFormToPatch(input)).eq('id', id).select('id'), z.array(z.object({ id: z.string() }))))
}

// ---------- horários ----------
const hourSchema = z
  .object({ id: z.string(), weekday: z.number().int(), opens: z.string(), closes: z.string() })
  .transform((r) => ({ id: r.id, weekday: r.weekday, opens: r.opens.slice(0, 5), closes: r.closes.slice(0, 5) }))
export type MerchantHour = z.output<typeof hourSchema>

export async function listHours(businessId: string): Promise<MerchantHour[]> {
  return exec(supabase.from('business_hours').select('id,weekday,opens,closes').eq('business_id', businessId).order('weekday').order('opens'), z.array(hourSchema))
}

export const hourInputSchema = z
  .object({ weekday: z.number().int().min(0).max(6), opens: z.string().regex(/^\d{2}:\d{2}$/), closes: z.string().regex(/^\d{2}:\d{2}$/) })
  .refine((v) => v.opens !== v.closes, { message: 'Abertura e fechamento não podem ser iguais.', path: ['closes'] })

export async function addHour(businessId: string, input: z.input<typeof hourInputSchema>): Promise<void> {
  const v = hourInputSchema.parse(input)
  await exec(supabase.from('business_hours').insert({ business_id: businessId, ...v }).select('id'), z.array(z.object({ id: z.string() })))
}

export async function removeHour(id: string): Promise<void> {
  one(await exec(supabase.from('business_hours').delete().eq('id', id).select('id'), z.array(z.object({ id: z.string() }))))
}

// ---------- cardápio ----------
const categorySchema = z
  .object({ id: z.string(), name: z.string(), sort_order: z.number(), is_active: z.boolean() })
  .transform((r) => ({ id: r.id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active }))
export type MerchantCategory = z.output<typeof categorySchema>

const productSchema = z
  .object({
    id: z.string(),
    category_id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    price_cents: z.number().int(),
    image_url: z.string().nullable(),
    is_available: z.boolean(),
    sort_order: z.number(),
  })
  .transform((r) => ({
    id: r.id,
    categoryId: r.category_id,
    name: r.name,
    description: r.description,
    priceCents: r.price_cents,
    imageUrl: r.image_url,
    isAvailable: r.is_available,
    sortOrder: r.sort_order,
  }))
export type MerchantProduct = z.output<typeof productSchema>

export async function listCategories(businessId: string): Promise<MerchantCategory[]> {
  return exec(supabase.from('menu_categories').select('id,name,sort_order,is_active').eq('business_id', businessId).order('sort_order').order('name'), z.array(categorySchema))
}

export async function listProducts(businessId: string): Promise<MerchantProduct[]> {
  return exec(
    supabase.from('products').select('id,category_id,name,description,price_cents,image_url,is_available,sort_order').eq('business_id', businessId).order('sort_order').order('name'),
    z.array(productSchema),
  )
}

const nameSchema = z.string().trim().min(1, 'Informe o nome.').max(80, 'Máximo de 80 caracteres.')

export async function createCategory(businessId: string, name: string, sortOrder = 0): Promise<void> {
  await exec(supabase.from('menu_categories').insert({ business_id: businessId, name: nameSchema.parse(name), sort_order: sortOrder }).select('id'), z.array(z.object({ id: z.string() })))
}

export async function updateCategory(id: string, patch: { name?: string; isActive?: boolean; sortOrder?: number }): Promise<void> {
  const body: Record<string, unknown> = {}
  if (patch.name !== undefined) body.name = nameSchema.parse(patch.name)
  if (patch.isActive !== undefined) body.is_active = patch.isActive
  if (patch.sortOrder !== undefined) body.sort_order = patch.sortOrder
  one(await exec(supabase.from('menu_categories').update(body).eq('id', id).select('id'), z.array(z.object({ id: z.string() }))))
}

export async function deleteCategory(id: string): Promise<void> {
  one(await exec(supabase.from('menu_categories').delete().eq('id', id).select('id'), z.array(z.object({ id: z.string() }))))
}

export const productFormSchema = z.object({
  categoryId: z.string().min(1, 'Escolha a categoria.'),
  name: z.string().trim().min(1, 'Informe o nome.').max(120, 'Máximo de 120 caracteres.'),
  description: z.string().trim().max(500, 'Máximo de 500 caracteres.'),
  price: z.string().trim().refine((v) => {
    try {
      return parseBRL(v) <= 10_000_000
    } catch {
      return false
    }
  }, 'Preço inválido. Ex.: 24,90'),
  imageUrl: httpsUrl,
  isAvailable: z.boolean(),
})
export type ProductForm = z.input<typeof productFormSchema>

export function productFormToRow(input: ProductForm) {
  const v = productFormSchema.parse(input)
  return {
    category_id: v.categoryId,
    name: v.name,
    description: nul(v.description),
    price_cents: parseBRL(v.price),
    image_url: nul(v.imageUrl),
    is_available: v.isAvailable,
  }
}

export async function createProduct(businessId: string, input: ProductForm): Promise<void> {
  await exec(supabase.from('products').insert({ business_id: businessId, ...productFormToRow(input) }).select('id'), z.array(z.object({ id: z.string() })))
}

export async function updateProduct(id: string, input: ProductForm): Promise<void> {
  one(await exec(supabase.from('products').update(productFormToRow(input)).eq('id', id).select('id'), z.array(z.object({ id: z.string() }))))
}

export async function setProductAvailability(id: string, isAvailable: boolean): Promise<void> {
  one(await exec(supabase.from('products').update({ is_available: isAvailable }).eq('id', id).select('id'), z.array(z.object({ id: z.string() }))))
}

export async function deleteProduct(id: string): Promise<void> {
  one(await exec(supabase.from('products').delete().eq('id', id).select('id'), z.array(z.object({ id: z.string() }))))
}
