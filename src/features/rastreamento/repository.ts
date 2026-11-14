import { z } from 'zod'
import { RepositoryError, backendUnavailable, mapPostgrestError } from '../../lib/errors'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import type { LngLat } from './geo'

/** Rastreamento da entrega (0037). Coordenadas só pela função delivery_tracking; o tempo real só avisa que mudou. */

const point = z.object({ lat: z.coerce.number(), lng: z.coerce.number() })
const trackingSchema = z.object({
  leg: z.enum(['coleta', 'entrega']).nullable(),
  viewer: z.enum(['cliente', 'entregador', 'loja', 'plataforma']),
  status: z.string(),
  vehicle: z.string().nullable(),
  business: z.object({ name: z.string().nullable(), address: z.string().nullable(), lat: z.coerce.number().nullable(), lng: z.coerce.number().nullable() }),
  destination: point.nullable(),
  position: z.object({
    lat: z.coerce.number(), lng: z.coerce.number(), accuracy_m: z.number().nullable(), heading: z.number().nullable(), speed_kmh: z.number().nullable(),
    recorded_at: z.string(), received_at: z.string(),
  }).nullable(),
  route: z.object({
    leg: z.enum(['coleta', 'entrega']), geometry: z.array(z.tuple([z.number(), z.number()])), distance_m: z.number(), duration_s: z.number(),
    provider: z.string(), computed_at: z.string(),
  }).nullable(),
  server_time: z.string(),
})
export type Tracking = z.infer<typeof trackingSchema>

type Res = { data: unknown; error: { code?: string; message: string } | null }
async function exec<T>(q: PromiseLike<Res>, schema: z.ZodType<T>): Promise<T> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  let res: Res
  try { res = await q } catch (e) { throw mapPostgrestError({ message: e instanceof Error ? e.message : String(e) }) }
  if (res.error) throw mapPostgrestError(res.error)
  const parsed = schema.safeParse(res.data)
  if (!parsed.success) throw new RepositoryError('validation', 'Recebemos dados inesperados do servidor.', undefined, { cause: parsed.error })
  return parsed.data
}

export const getTracking = (orderId: string) => exec(supabase.rpc('delivery_tracking', { _order: orderId }), trackingSchema)

export const setDeliveryPoint = (orderId: string, lat: number, lng: number) =>
  exec(supabase.rpc('customer_set_delivery_point', { _order: orderId, _lat: lat, _lng: lng }), z.unknown()).then(() => undefined)

export interface Fix { lat: number; lng: number; accuracy: number | null; heading: number | null; speedKmh: number | null; at: number }
export const sendLocation = (orderId: string, f: Fix) =>
  exec(supabase.rpc('courier_track_location', {
    _order: orderId, _lat: f.lat, _lng: f.lng, _accuracy_m: f.accuracy === null ? null : Math.round(f.accuracy),
    _heading: f.heading === null ? null : Math.round(f.heading) % 360, _speed_kmh: f.speedKmh === null ? null : Math.round(f.speedKmh),
    _recorded_at: new Date(f.at).toISOString(),
  }), z.enum(['coleta', 'entrega']))

export const stopSharing = (orderId: string) => exec(supabase.rpc('courier_stop_tracking', { _order: orderId }), z.unknown()).then(() => undefined)

/** Pede ao Worker a rota da etapa atual (limites e permissão conferidos no banco). */
export async function requestRoute(orderId: string, leg: 'coleta' | 'entrega'): Promise<{ distanceM: number; durationS: number }> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new RepositoryError('forbidden', 'Entre na sua conta.')
  const res = await fetch('/api/rota', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ order: orderId, leg }) })
  const body = (await res.json().catch(() => ({}))) as { erro?: string; distance_m?: number; duration_s?: number }
  if (!res.ok) throw new RepositoryError('unknown', body.erro ?? 'Não foi possível calcular a rota.')
  return { distanceM: body.distance_m ?? 0, durationS: body.duration_s ?? 0 }
}

/**
 * Avisa quando a posição/rota do pedido muda. Principal: Realtime Broadcast em canal PRIVADO do pedido (0039; o Supabase
 * só entrega a quem pode ver o pedido). Reserva: postgres_changes do aviso da 0037. Nenhum dos dois leva coordenadas.
 * Avisos repetidos dentro de 1 s viram um só. Devolve a função para cancelar.
 */
export function subscribeTracking(orderId: string, onChange: () => void): () => void {
  if (!isSupabaseConfigured) return () => undefined
  let last = 0
  const fire = () => { const now = Date.now(); if (now - last > 1000) { last = now; onChange() } }
  const privateChannel = supabase
    .channel(`rastreio:${orderId}`, { config: { private: true } })
    .on('broadcast', { event: 'atualizado' }, () => fire())
    .subscribe((status) => { if (status === 'SUBSCRIBED') fire() })
  const dbChannel = supabase
    .channel(`rastreio-db:${orderId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_tracking_ticks', filter: `order_id=eq.${orderId}` }, () => fire())
    .subscribe()
  return () => { void supabase.removeChannel(privateChannel); void supabase.removeChannel(dbChannel) }
}

export const toLngLat = (p: { lat: number; lng: number }): LngLat => [p.lng, p.lat]

// ---------- instruções de conversão (0046): só o entregador da etapa ----------
const stepSchema = z.object({ text: z.string(), type: z.string(), distance_m: z.number(), at: z.tuple([z.number(), z.number()]).nullable().optional() })
  .transform((s) => ({ text: s.text, type: s.type, distance_m: s.distance_m, at: (s.at ?? null) as LngLat | null }))
export type RouteStepView = z.output<typeof stepSchema>

/** Instruções da etapa atual. Sem a 0046 no banco (ou sem rota), devolve lista vazia: a navegação segue só com o traçado. */
export async function getRouteSteps(orderId: string): Promise<RouteStepView[]> {
  if (!isSupabaseConfigured) return []
  const { data, error } = await supabase.rpc('courier_route_steps', { _order: orderId })
  if (error) return []
  const parsed = z.object({ steps: z.array(stepSchema) }).safeParse(data)
  return parsed.success ? parsed.data.steps : []
}
