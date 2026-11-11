import { z } from 'zod'
import { RepositoryError, backendUnavailable, mapPostgrestError } from '../../lib/errors'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { BUSINESS_COLUMNS, BUSINESSES_VIEW } from '../catalog/repository'
import { businessRowSchema, type BusinessSummary } from '../catalog/schemas'

/** Página pública do estabelecimento: tudo vem do banco, sob RLS (só ativos aparecem). */

async function query<T>(q: PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>, schema: z.ZodType<T>): Promise<T> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  let res: { data: unknown; error: { code?: string; message: string } | null }
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

export async function getPublicBusiness(slug: string): Promise<BusinessSummary | null> {
  return query(supabase.from(BUSINESSES_VIEW).select(BUSINESS_COLUMNS).eq('slug', slug).maybeSingle(), businessRowSchema.nullable())
}

const optionSchema = z.object({ id: z.string(), group_id: z.string(), name: z.string(), price_delta_cents: z.number().int(), is_available: z.boolean(), sort_order: z.number() })
const groupSchema = z.object({ id: z.string(), product_id: z.string(), name: z.string(), min_select: z.number(), max_select: z.number(), sort_order: z.number() })
const productSchema = z.object({
  id: z.string(),
  category_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  price_cents: z.number().int(),
  image_url: z.string().nullable(),
  is_available: z.boolean(),
  sort_order: z.number(),
})
const menuCategorySchema = z.object({ id: z.string(), name: z.string(), sort_order: z.number() })

export interface MenuOption { id: string; name: string; priceDeltaCents: number; isAvailable: boolean }
export interface MenuGroup { id: string; name: string; minSelect: number; maxSelect: number; options: MenuOption[] }
export interface MenuProduct {
  id: string
  name: string
  description: string | null
  priceCents: number
  imageUrl: string | null
  isAvailable: boolean
  groups: MenuGroup[]
}
export interface MenuSection { id: string; name: string; products: MenuProduct[] }

const bySort = <T extends { sort_order: number; name: string }>(a: T, b: T) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'pt-BR')

/** Monta o cardápio em seções (categorias vazias são omitidas). */
export function buildMenu(
  categories: z.infer<typeof menuCategorySchema>[],
  products: z.infer<typeof productSchema>[],
  groups: z.infer<typeof groupSchema>[],
  options: z.infer<typeof optionSchema>[],
): MenuSection[] {
  const optionsByGroup = new Map<string, MenuOption[]>()
  for (const o of [...options].sort(bySort)) {
    const list = optionsByGroup.get(o.group_id) ?? []
    list.push({ id: o.id, name: o.name, priceDeltaCents: o.price_delta_cents, isAvailable: o.is_available })
    optionsByGroup.set(o.group_id, list)
  }
  const groupsByProduct = new Map<string, MenuGroup[]>()
  for (const g of [...groups].sort(bySort)) {
    const list = groupsByProduct.get(g.product_id) ?? []
    list.push({ id: g.id, name: g.name, minSelect: g.min_select, maxSelect: g.max_select, options: optionsByGroup.get(g.id) ?? [] })
    groupsByProduct.set(g.product_id, list)
  }
  return [...categories]
    .sort(bySort)
    .map((c) => ({
      id: c.id,
      name: c.name,
      products: products
        .filter((p) => p.category_id === c.id)
        .sort(bySort)
        .map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          priceCents: p.price_cents,
          imageUrl: p.image_url,
          isAvailable: p.is_available,
          groups: groupsByProduct.get(p.id) ?? [],
        })),
    }))
    .filter((s) => s.products.length > 0)
}

export async function getMenu(businessId: string): Promise<MenuSection[]> {
  const [categories, products, groups, options] = await Promise.all([
    query(supabase.from('menu_categories').select('id,name,sort_order').eq('business_id', businessId).eq('is_active', true), z.array(menuCategorySchema)),
    query(supabase.from('products').select('id,category_id,name,description,price_cents,image_url,is_available,sort_order').eq('business_id', businessId), z.array(productSchema)),
    query(supabase.from('option_groups').select('id,product_id,name,min_select,max_select,sort_order').eq('business_id', businessId), z.array(groupSchema)),
    query(supabase.from('options').select('id,group_id,name,price_delta_cents,is_available,sort_order').eq('business_id', businessId), z.array(optionSchema)),
  ])
  return buildMenu(categories, products, groups, options)
}

const reviewSchema = z
  .object({ id: z.string(), rating: z.number().int(), comment: z.string().nullable(), author_name: z.string().nullable(), created_at: z.string(), reply: z.string().nullable().optional() })
  .transform((r) => ({ id: r.id, rating: r.rating, comment: r.comment, authorName: r.author_name, createdAt: r.created_at, reply: r.reply ?? null }))
export type PublicReview = z.output<typeof reviewSchema>

export async function getReviews(businessId: string): Promise<PublicReview[]> {
  return query(
    supabase.from('reviews').select('id,rating,comment,author_name,created_at,reply').eq('business_id', businessId).order('created_at', { ascending: false }).limit(20),
    z.array(reviewSchema),
  )
}
