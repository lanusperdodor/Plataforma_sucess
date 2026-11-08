/**
 * DADOS LOCAIS DE DEMONSTRAÇÃO (prévia visual). Espelham o seed supabase/seed/demo_itau_de_minas.sql.
 * Todos os registros têm isDemo = true e nomes com "(demo)". Não são lojas, avaliações ou preços reais.
 */
import { isOpenNow, type HoursWindow } from '../../lib/time'
import type { BusinessHour, BusinessSummary, Category, City } from './schemas'

export const DEMO_CITY: City = {
  id: 'demo-city-itau-de-minas',
  name: 'Itaú de Minas',
  state: 'MG',
  slug: 'itau-de-minas',
  centerLat: -20.7389,
  centerLng: -46.7597,
  isDemo: true,
}

const cat = (slug: string, label: string, kind: Category['kind'], icon: string, sortOrder: number): Category => ({
  id: `demo-cat-${slug}`,
  slug,
  label,
  kind,
  icon,
  sortOrder,
  isDemo: true,
})

export const DEMO_CATEGORIES: Category[] = [
  cat('lanches', 'Lanches', 'restaurante', 'Sandwich', 1),
  cat('pizzas', 'Pizzas', 'restaurante', 'Pizza', 2),
  cat('marmitas', 'Marmitas', 'restaurante', 'UtensilsCrossed', 3),
  cat('acai', 'Açaí', 'restaurante', 'IceCreamBowl', 4),
  cat('farmacia', 'Farmácia', 'loja', 'Pill', 5),
  cat('roupas', 'Roupas', 'loja', 'Shirt', 6),
  cat('calcados', 'Calçados', 'loja', 'Footprints', 7),
  cat('beleza', 'Beleza', 'servico', 'Scissors', 8),
  cat('servicos', 'Serviços', 'servico', 'Wrench', 9),
  cat('vagas', 'Vagas', 'vaga', 'Briefcase', 10),
]

type Row = {
  k: string
  name: string
  type: BusinessSummary['businessType']
  cat: string
  addr: string
  dist: number
  offer: BusinessSummary['deliveryOffer']
  fee: number
  pickup: boolean
  tmin: number | null
  tmax: number | null
  minOrder: number
  tier: 1 | 2 | 3 | 4
  pop: number
  featured: boolean
  rating: [number, number]
  hours: { days: number[]; opens: string; closes: string }
}

const ALL = [0, 1, 2, 3, 4, 5, 6]
const ROWS: Row[] = [
  { k: 'lanchonete', name: 'Lanchonete Exemplo (demo)', type: 'restaurante', cat: 'lanches', addr: 'Rua Exemplo, 100 (demo)', dist: 0.2, offer: 'partner', fee: 0, pickup: true, tmin: 25, tmax: 40, minOrder: 1500, tier: 1, pop: 90, featured: true, rating: [4.7, 3], hours: { days: ALL, opens: '10:00', closes: '22:00' } },
  { k: 'pizzaria', name: 'Pizzaria Modelo (demo)', type: 'restaurante', cat: 'pizzas', addr: 'Av. Modelo, 250 (demo)', dist: 0.6, offer: 'own', fee: 600, pickup: true, tmin: 35, tmax: 55, minOrder: 3000, tier: 2, pop: 80, featured: true, rating: [4.5, 2], hours: { days: ALL, opens: '18:00', closes: '01:00' } },
  { k: 'marmitaria', name: 'Marmitaria Teste (demo)', type: 'restaurante', cat: 'marmitas', addr: 'Rua Teste, 45 (demo)', dist: 0.5, offer: 'own', fee: 400, pickup: false, tmin: 30, tmax: 45, minOrder: 1800, tier: 1, pop: 70, featured: false, rating: [3.5, 2], hours: { days: [1, 2, 3, 4, 5], opens: '11:00', closes: '14:30' } },
  { k: 'acai', name: 'Açaí Fictício (demo)', type: 'restaurante', cat: 'acai', addr: 'Praça Fictícia, 12 (demo)', dist: 0.4, offer: 'partner', fee: 0, pickup: false, tmin: 20, tmax: 35, minOrder: 1200, tier: 2, pop: 60, featured: false, rating: [5, 1], hours: { days: ALL, opens: '13:00', closes: '23:00' } },
  { k: 'hamburgueria', name: 'Hamburgueria Amostra (demo)', type: 'restaurante', cat: 'lanches', addr: 'Rua Amostra, 300 (demo)', dist: 1.1, offer: 'none', fee: 0, pickup: true, tmin: 25, tmax: 40, minOrder: 2000, tier: 3, pop: 85, featured: true, rating: [4.5, 2], hours: { days: ALL, opens: '18:00', closes: '24:00' } },
  { k: 'sorveteria', name: 'Sorveteria Quase Fechada (demo)', type: 'restaurante', cat: 'acai', addr: 'Rua Silêncio, 1 (demo)', dist: 0.9, offer: 'none', fee: 0, pickup: true, tmin: 15, tmax: 30, minOrder: 0, tier: 1, pop: 10, featured: false, rating: [0, 0], hours: { days: [1], opens: '06:00', closes: '06:30' } },
  { k: 'farmacia', name: 'Farmácia Exemplo (demo)', type: 'loja', cat: 'farmacia', addr: 'Rua da Amostra, 10 (demo)', dist: 0.1, offer: 'partner', fee: 0, pickup: true, tmin: 30, tmax: 50, minOrder: 0, tier: 2, pop: 75, featured: true, rating: [4, 1], hours: { days: ALL, opens: '08:00', closes: '20:00' } },
  { k: 'roupas', name: 'Moda Modelo (demo)', type: 'loja', cat: 'roupas', addr: 'Rua Moda, 77 (demo)', dist: 0.3, offer: 'own', fee: 800, pickup: true, tmin: 60, tmax: 120, minOrder: 5000, tier: 2, pop: 50, featured: false, rating: [3, 1], hours: { days: [1, 2, 3, 4, 5, 6], opens: '09:00', closes: '18:00' } },
  { k: 'calcados', name: 'Calçados Teste (demo)', type: 'loja', cat: 'calcados', addr: 'Av. Passos, 500 (demo)', dist: 0.8, offer: 'none', fee: 0, pickup: true, tmin: null, tmax: null, minOrder: 0, tier: 2, pop: 40, featured: false, rating: [0, 0], hours: { days: [1, 2, 3, 4, 5, 6], opens: '09:00', closes: '18:00' } },
  { k: 'beleza', name: 'Salão Exemplo (demo)', type: 'servico', cat: 'beleza', addr: 'Rua Beleza, 8 (demo)', dist: 0.2, offer: 'none', fee: 0, pickup: false, tmin: null, tmax: null, minOrder: 0, tier: 2, pop: 55, featured: false, rating: [5, 1], hours: { days: [2, 3, 4, 5, 6], opens: '09:00', closes: '18:00' } },
  { k: 'eletricista', name: 'Eletricista Modelo (demo)', type: 'servico', cat: 'servicos', addr: 'Atendimento a domicílio (demo)', dist: 0.7, offer: 'none', fee: 0, pickup: false, tmin: null, tmax: null, minOrder: 0, tier: 2, pop: 45, featured: false, rating: [0, 0], hours: { days: [1, 2, 3, 4, 5], opens: '08:00', closes: '17:00' } },
  { k: 'diarista', name: 'Limpeza Teste (demo)', type: 'servico', cat: 'servicos', addr: 'Atendimento a domicílio (demo)', dist: 0.6, offer: 'none', fee: 0, pickup: false, tmin: null, tmax: null, minOrder: 0, tier: 1, pop: 35, featured: false, rating: [0, 0], hours: { days: [1, 2, 3, 4, 5], opens: '08:00', closes: '17:00' } },
]

export function demoHours(businessId: string): BusinessHour[] {
  const row = ROWS.find((r) => `demo-biz-${r.k}` === businessId)
  if (!row) return []
  return row.hours.days.map((weekday) => ({ weekday, opens: row.hours.opens, closes: row.hours.closes }))
}

/** Estabelecimentos demo; `isOpen` é calculado no fuso de São Paulo a partir dos horários. */
export function demoBusinesses(at: Date = new Date()): BusinessSummary[] {
  return ROWS.map((r) => {
    const id = `demo-biz-${r.k}`
    const hours = demoHours(id) as HoursWindow[]
    return {
      id,
      name: r.name,
      slug: `${r.k}-demo`,
      businessType: r.type,
      categoryId: `demo-cat-${r.cat}`,
      cityId: DEMO_CITY.id,
      description: 'Estabelecimento fictício de demonstração.',
      coverUrl: null,
      logoUrl: null,
      addressLine: r.addr,
      phone: null,
      whatsapp: null,
      lat: null,
      lng: null,
      distanceEstimateKm: r.dist,
      distanceKm: undefined,
      deliveryOffer: r.offer,
      ownDeliveryFeeCents: r.fee,
      acceptsPickup: r.pickup,
      estimatedMinMinutes: r.tmin,
      estimatedMaxMinutes: r.tmax,
      minOrderCents: r.minOrder,
      priceTier: r.tier,
      ratingAvg: r.rating[0],
      ratingCount: r.rating[1],
      popularityScore: r.pop,
      isFeatured: r.featured,
      isDemo: true,
      isOpen: isOpenNow(hours, at),
    }
  })
}