import type { ZodType } from 'zod'
import { RepositoryError, backendUnavailable, mapPostgrestError } from '../../lib/errors'
import { PAGE_SIZE, pageRange, toPage, type Page } from '../../lib/pagination'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import {
  businessHourSchema,
  businessRowSchema,
  categorySchema,
  citySchema,
  type BusinessHour,
  type BusinessSummary,
  type Category,
  type CategoryKind,
  type City,
} from './schemas'
import { toQuerySpec } from './filters'

/** Estabelecimentos públicos vêm SEMPRE da visão (a tabela `businesses` não é legível pelo público). */
export const BUSINESSES_VIEW = 'public_businesses'

const CITY_COLUMNS = 'id,name,state,slug,center_lat,center_lng'
const CATEGORY_COLUMNS = 'id,slug,label,kind,icon,sort_order'
export const BUSINESS_COLUMNS =
  'id,name,slug,business_type,category_id,city_id,description,cover_url,logo_url,address_line,phone,whatsapp,' +
  'lat,lng,distance_estimate_km,delivery_offer,own_delivery_fee_cents,accepts_pickup,' +
  'estimated_min_minutes,estimated_max_minutes,min_order_cents,price_tier,rating_avg,rating_count,' +
  'popularity_score,is_featured,is_open'

export type RestaurantSort = 'proximity' | 'popularity' | 'delivery_time'

export interface RestaurantQueryFilters {
  categorySlug?: string
  fulfillment?: 'delivery' | 'pickup'
  minRating?: number
  priceTiers?: readonly (1 | 2 | 3 | 4)[]
  sort?: RestaurantSort
}

interface RawResult {
  data: unknown
  error: { code?: string; message: string; details?: string } | null
}

/** Executa a consulta, converte falhas (inclusive exceções de rede) em RepositoryError. */
async function run(query: PromiseLike<RawResult>): Promise<unknown> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  let res: RawResult
  try {
    res = await query
  } catch (e) {
    if (e instanceof RepositoryError) throw e
    throw mapPostgrestError({ message: e instanceof Error ? e.message : String(e) })
  }
  if (res.error) throw mapPostgrestError(res.error)
  return res.data
}

function parseRows<T>(schema: ZodType<T>, data: unknown): T[] {
  const parsed = schema.array().safeParse(data ?? [])
  if (!parsed.success) {
    throw new RepositoryError(
      'validation',
      'Recebemos dados inesperados do servidor. Tente novamente.',
      undefined,
      { cause: parsed.error },
    )
  }
  return parsed.data
}

async function remoteListCities(): Promise<City[]> {
  // Só na prévia estática (sem acesso à rede): cópia da lista real de cidades lida do banco no build.
  const snapshot = import.meta.env.VITE_PREVIEW_CITIES
  if (snapshot) return parseRows(citySchema, JSON.parse(snapshot))
  const data = await run(supabase.from('cities').select(CITY_COLUMNS).order('name'))
  return parseRows(citySchema, data)
}

async function remoteListCategories(kind?: CategoryKind): Promise<Category[]> {
  let q = supabase.from('categories').select(CATEGORY_COLUMNS)
  if (kind) q = q.eq('kind', kind)
  const data = await run(q.order('sort_order').order('label'))
  return parseRows(categorySchema, data)
}

async function remoteListRestaurants(
  cityId: string,
  filters: RestaurantQueryFilters = {},
  page = 0,
): Promise<Page<BusinessSummary>> {
  let categoryId: string | undefined
  if (filters.categorySlug) {
    const rows = parseRows(
      categorySchema,
      await run(supabase.from('categories').select(CATEGORY_COLUMNS).eq('slug', filters.categorySlug)),
    )
    if (rows.length === 0) return toPage([], PAGE_SIZE, page)
    categoryId = rows[0]?.id
  }

  const spec = toQuerySpec(filters, cityId, categoryId)
  let q = supabase.from(BUSINESSES_VIEW).select(BUSINESS_COLUMNS)
  for (const [column, value] of spec.eq) q = q.eq(column, value as string | number | boolean)
  for (const [column, value] of spec.gte) q = q.gte(column, value)
  for (const [column, values] of spec.in) q = q.in(column, values as (string | number)[])
  for (const column of spec.notNull) q = q.not(column, 'is', null)
  for (const [column, dir] of spec.order) q = q.order(column, { ascending: dir === 'asc' })

  const { from, to } = pageRange(page, PAGE_SIZE)
  const data = await run(q.range(from, to))
  return toPage(parseRows(businessRowSchema, data), PAGE_SIZE, page)
}

async function remoteListFeatured(cityId: string, limit = 10): Promise<BusinessSummary[]> {
  const data = await run(
    supabase
      .from(BUSINESSES_VIEW)
      .select(BUSINESS_COLUMNS)
      .eq('city_id', cityId)
      .eq('is_featured', true)
      .order('popularity_score', { ascending: false })
      .order('id')
      .limit(limit),
  )
  return parseRows(businessRowSchema, data)
}

async function remoteGetBusinessHours(businessId: string): Promise<BusinessHour[]> {
  const data = await run(
    supabase
      .from('business_hours')
      .select('weekday,opens,closes')
      .eq('business_id', businessId)
      .order('weekday')
      .order('opens'),
  )
  return parseRows(businessHourSchema, data)
}

// ---------- API pública do repositório (somente dados reais do Supabase) ----------

export function listCities(): Promise<City[]> {
  return remoteListCities()
}

/**
 * Busca de cidades no banco (0023): sem acento e sem maiúsculas, filtro por UF e limite de resultados,
 * para funcionar com milhares de municípios sem carregar a lista inteira.
 * Retorna null quando o banco ainda não tem a função (a tela usa a lista já carregada).
 */
export async function searchCities(term: string, state: string | null, limit = 30): Promise<City[] | null> {
  if (!isSupabaseConfigured) return null
  const res = await supabase.rpc('search_cities', { _q: term.trim() || null, _state: state, _limit: limit })
  if (res.error) {
    if (res.error.code === 'PGRST202' || res.error.code === '42883') return null
    throw mapPostgrestError(res.error)
  }
  return parseRows(citySchema, res.data)
}

/** Uma cidade pelo id (cidade escolhida que não está na lista carregada). */
export async function getCityById(id: string): Promise<City | null> {
  const data = await run(supabase.from('cities').select(CITY_COLUMNS).eq('id', id).limit(1))
  return parseRows(citySchema, data)[0] ?? null
}

export function listCategories(kind?: CategoryKind): Promise<Category[]> {
  return remoteListCategories(kind)
}

export function listRestaurants(
  cityId: string,
  filters: RestaurantQueryFilters = {},
  page = 0,
): Promise<Page<BusinessSummary>> {
  return remoteListRestaurants(cityId, filters, page)
}

export function listFeatured(cityId: string, limit = 10): Promise<BusinessSummary[]> {
  return remoteListFeatured(cityId, limit)
}

export function getBusinessHours(businessId: string): Promise<BusinessHour[]> {
  return remoteGetBusinessHours(businessId)
}

/** Estabelecimentos de um tipo (lojas, serviços) na cidade, por popularidade. */
export async function listBusinesses(
  cityId: string,
  type: BusinessSummary['businessType'],
  categorySlug?: string,
): Promise<BusinessSummary[]> {
  let q = supabase.from(BUSINESSES_VIEW).select(BUSINESS_COLUMNS).eq('city_id', cityId).eq('business_type', type)
  if (categorySlug) {
    const cats = parseRows(categorySchema, await run(supabase.from('categories').select(CATEGORY_COLUMNS).eq('slug', categorySlug)))
    if (cats.length === 0) return []
    q = q.eq('category_id', cats[0]!.id)
  }
  const data = await run(q.order('popularity_score', { ascending: false }).order('id').limit(48))
  return parseRows(businessRowSchema, data)
}
