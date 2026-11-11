import { z } from 'zod'

/**
 * Schemas das linhas do banco (snake_case) com transformação para o domínio (camelCase).
 * Estabelecimentos vêm da visão `public_businesses` (a tabela `businesses` não é pública).
 */

export const categoryKinds = ['restaurante', 'loja', 'servico', 'vaga'] as const
export type CategoryKind = (typeof categoryKinds)[number]

export const businessTypes = ['restaurante', 'loja', 'servico'] as const
export type BusinessType = (typeof businessTypes)[number]

export const deliveryOffers = ['partner', 'own', 'none'] as const
export type DeliveryOffer = (typeof deliveryOffers)[number]

// ---------- cidades ----------
export const citySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    state: z.string(),
    slug: z.string(),
    center_lat: z.number().nullable(),
    center_lng: z.number().nullable(),
  })
  .transform((r) => ({
    id: r.id,
    name: r.name,
    state: r.state,
    slug: r.slug,
    centerLat: r.center_lat,
    centerLng: r.center_lng,
  }))
export type City = z.output<typeof citySchema>

// ---------- categorias ----------
export const categorySchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    label: z.string(),
    kind: z.enum(categoryKinds),
    icon: z.string().nullable(),
    sort_order: z.number(),
  })
  .transform((r) => ({
    id: r.id,
    slug: r.slug,
    label: r.label,
    kind: r.kind,
    icon: r.icon,
    sortOrder: r.sort_order,
  }))
export type Category = z.output<typeof categorySchema>

// ---------- estabelecimentos (visão public_businesses) ----------
export const businessRowSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    business_type: z.enum(businessTypes),
    category_id: z.string().nullable(),
    city_id: z.string().nullable(),
    description: z.string().nullable(),
    cover_url: z.string().nullable(),
    logo_url: z.string().nullable(),
    address_line: z.string().nullable(),
    phone: z.string().nullable(),
    whatsapp: z.string().nullable(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    distance_estimate_km: z.number().nullable(),
    delivery_offer: z.enum(deliveryOffers),
    own_delivery_fee_cents: z.number().int(),
    accepts_pickup: z.boolean(),
    estimated_min_minutes: z.number().nullable(),
    estimated_max_minutes: z.number().nullable(),
    min_order_cents: z.number().int(),
    price_tier: z.number().int().min(1).max(4).nullable(),
    rating_avg: z.number(),
    rating_count: z.number().int(),
    popularity_score: z.number(),
    is_featured: z.boolean(),
    is_open: z.boolean(),
  })
  .transform((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    businessType: r.business_type,
    categoryId: r.category_id,
    cityId: r.city_id,
    description: r.description,
    coverUrl: r.cover_url,
    logoUrl: r.logo_url,
    addressLine: r.address_line,
    phone: r.phone,
    whatsapp: r.whatsapp,
    lat: r.lat,
    lng: r.lng,
    /** ESTIMATIVA ao centro da cidade; a UI rotula "≈ X km do centro (estimativa)". */
    distanceEstimateKm: r.distance_estimate_km,
    /** Distância real (geolocalização) — preenchida no futuro; hoje sempre ausente. */
    distanceKm: undefined as number | undefined,
    deliveryOffer: r.delivery_offer,
    ownDeliveryFeeCents: r.own_delivery_fee_cents,
    acceptsPickup: r.accepts_pickup,
    estimatedMinMinutes: r.estimated_min_minutes,
    estimatedMaxMinutes: r.estimated_max_minutes,
    minOrderCents: r.min_order_cents,
    priceTier: r.price_tier as 1 | 2 | 3 | 4 | null,
    ratingAvg: r.rating_avg,
    ratingCount: r.rating_count,
    popularityScore: r.popularity_score,
    isFeatured: r.is_featured,
    isOpen: r.is_open,
  }))
export type BusinessSummary = z.output<typeof businessRowSchema>

// ---------- horários ----------
const timeText = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/)

export const businessHourSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    opens: timeText,
    closes: timeText,
  })
  .transform((r) => ({
    weekday: r.weekday,
    opens: r.opens.slice(0, 5),
    closes: r.closes.slice(0, 5),
  }))
export type BusinessHour = z.output<typeof businessHourSchema>
