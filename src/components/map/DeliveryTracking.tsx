import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, LocateFixed, MapPinned, Navigation, SignalLow } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useToast } from '../feedback/toast-context.ts'
import { estimate, formatDistance, freshness } from '../../features/rastreamento/geo.ts'
import { getTracking, setDeliveryPoint, subscribeTracking, toLngLat, type Tracking } from '../../features/rastreamento/repository.ts'

const DeliveryMap = lazy(() => import('./DeliveryMap.tsx'))
const hhmmss = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const FINAL = new Set(['delivered', 'picked_up', 'cancelled', 'rejected'])

/** Lê a posição do aparelho UMA vez (para marcar o ponto de entrega). */
export function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Este aparelho não informa a localização.'))
    navigator.geolocation.getCurrentPosition(resolve, (e) => reject(new Error(e.code === 1 ? 'Permissão de localização negada.' : 'Não foi possível obter a localização.')), { enableHighAccuracy: true, timeout: 15_000 })
  })
}

function useNow(ms = 5000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = globalThis.setInterval(() => setNow(Date.now()), ms); return () => globalThis.clearInterval(t) }, [ms])
  return now
}

export function trackingSummary(t: Tracking, now: number): { tone: 'ok' | 'warn' | 'off' | 'wait'; text: string } {
  if (!t.leg) return { tone: 'wait', text: 'O acompanhamento no mapa começa quando um entregador assume a entrega.' }
  if (!t.position) return { tone: 'wait', text: 'Aguardando a localização do entregador. Ela aparece quando ele começar a compartilhar.' }
  const f = freshness(t.position.recorded_at, now)
  if (f === 'ao_vivo') return { tone: 'ok', text: `Ao vivo · atualizado às ${hhmmss(t.position.recorded_at)}` }
  if (f === 'atrasada') return { tone: 'warn', text: `Atualizado às ${hhmmss(t.position.recorded_at)} · aguardando nova posição` }
  return { tone: 'off', text: `Localização desatualizada (última às ${hhmmss(t.position.recorded_at)}). O entregador pode estar sem sinal; a moto mostra a última posição recebida.` }
}

/** Mapa de acompanhamento da entrega para quem pode ver o pedido (cliente, loja até a coleta, Master). */
export function DeliveryTracking({ orderId }: { orderId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const now = useNow()
  const q = useQuery({
    queryKey: ['rastreio', orderId],
    queryFn: () => getTracking(orderId),
    // o tempo real avisa as mudanças; a consulta periódica cobre aviso perdido
    refetchInterval: (query) => (query.state.data && FINAL.has(query.state.data.status) ? false : 30_000),
  })
  useEffect(() => subscribeTracking(orderId, () => void qc.invalidateQueries({ queryKey: ['rastreio', orderId] })), [orderId, qc])
  const mark = useMutation({
    mutationFn: async () => {
      const p = await currentPosition()
      await setDeliveryPoint(orderId, p.coords.latitude, p.coords.longitude)
    },
    onSuccess: () => { toast.success('Ponto de entrega marcado no mapa.'); void qc.invalidateQueries({ queryKey: ['rastreio', orderId] }) },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível marcar o ponto.'),
  })

  if (q.isError || !q.data) return q.isLoading ? <div className="h-72 animate-pulse rounded-card bg-muted sm:h-96" aria-hidden="true" /> : null
  const t = q.data
  if (FINAL.has(t.status)) return null
  const s = trackingSummary(t, now)
  const pos = t.position ? toLngLat(t.position) : null
  const stale = !!t.position && freshness(t.position.recorded_at, now) === 'desatualizada'
  const est = pos && t.position && t.route ? estimate(pos, t.position.recorded_at, t.route, now) : null
  const business = t.business.lat !== null && t.business.lng !== null ? toLngLat({ lat: t.business.lat, lng: t.business.lng }) : null
  const destination = t.destination ? toLngLat(t.destination) : null
  const canMark = t.viewer === 'cliente' && !t.destination && ['placed', 'accepted', 'preparing', 'ready'].includes(t.status)
  const toneClass = { ok: 'text-success', warn: 'text-ink', off: 'text-danger', wait: 'text-ink-muted' }[s.tone]

  return (
    <section aria-labelledby="mapa-entrega" className="flex flex-col gap-3">
      <h2 id="mapa-entrega" className="flex items-center gap-2 text-base font-semibold text-ink"><MapPinned aria-hidden="true" className="size-5" />Acompanhe no mapa</h2>
      <Suspense fallback={<div className="h-72 animate-pulse rounded-card bg-muted sm:h-96" aria-hidden="true" />}>
        <DeliveryMap
          business={business}
          destination={destination}
          position={pos}
          heading={t.position?.heading ?? null}
          route={t.route?.geometry ?? null}
          stale={stale}
          label={`Mapa da entrega. ${s.text}${est ? ` Faltam cerca de ${formatDistance(est.remainingM)}, previsão de ${est.etaMin} minutos.` : ''}`}
        />
      </Suspense>
      <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
        <p role="status" aria-live="polite" className={`flex items-start gap-2 text-sm font-medium ${toneClass}`}>
          {s.tone === 'off' ? <SignalLow aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
          {s.text}
        </p>
        {est && (
          <p className="flex items-center gap-2 text-sm text-ink">
            <Navigation aria-hidden="true" className="size-4" />
            <span><strong>{formatDistance(est.remainingM)}</strong> · cerca de <strong>{est.etaMin} min</strong> {t.leg === 'coleta' ? 'até a loja' : 'até você'}</span>
          </p>
        )}
      </div>
      {t.viewer === 'cliente' && t.leg === 'coleta' && t.position && (
        <p className="text-xs text-ink-muted">Até a retirada do pedido, a posição do entregador aparece aproximada (cerca de 100 m), para proteger a privacidade dele.</p>
      )}
      {t.route && !est && t.position && !stale && <p className="text-xs text-ink-muted">Distância e previsão aparecem quando o entregador está no trajeto calculado.</p>}
      {canMark && (
        <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink">Está no local de entrega? Marque o ponto exato para o entregador chegar mais fácil e o mapa mostrar a rota até você.</p>
          <button type="button" disabled={mark.isPending} onClick={() => mark.mutate()} className="pressable inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-ink">
            <LocateFixed aria-hidden="true" className="size-4" />{mark.isPending ? 'Localizando…' : 'Usar minha localização'}
          </button>
        </div>
      )}
      {t.viewer === 'plataforma' && <p className="text-xs text-ink-muted">Acesso registrado na auditoria.</p>}
    </section>
  )
}

