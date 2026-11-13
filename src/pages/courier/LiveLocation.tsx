import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigation, Radio, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { googleMapsRoute, routeProgress, shouldSend, OFF_ROUTE_M, type LngLat } from '../../features/rastreamento/geo.ts'
import { getTracking, requestRoute, sendLocation, stopSharing } from '../../features/rastreamento/repository.ts'

type WakeLockLike = { release(): Promise<void> }
const nav = () => navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockLike> } }

/**
 * Compartilhamento da localização REAL do entregador durante uma entrega. Só começa quando ele toca no botão
 * (o navegador pede a permissão). Envia a cada ~20 s (antes, se andou bastante), mantém a tela acesa quando o
 * aparelho permite e para sozinho quando a entrega termina (o componente sai da tela e o banco apaga a posição).
 * Navegadores costumam pausar o GPS com a tela bloqueada ou o app em segundo plano: isso é avisado, não prometido.
 */
export function LiveLocation({ orderId, pickupAddress, dropoffAddress }: { orderId: string; pickupAddress: string | null; dropoffAddress: string | null }) {
  const qc = useQueryClient()
  const [on, setOn] = useState(false)
  const [state, setState] = useState<{ sentAt: number | null; error: string | null; accuracy: number | null; hidden: boolean }>({ sentAt: null, error: null, accuracy: null, hidden: false })
  const watch = useRef<number | null>(null)
  const last = useRef<{ at: number; pos: LngLat } | null>(null)
  const sending = useRef(false)
  const wake = useRef<WakeLockLike | null>(null)
  const routeAsk = useRef<{ at: number; leg: string | null; offCount: number }>({ at: 0, leg: null, offCount: 0 })
  const t = useQuery({ queryKey: ['rastreio', orderId], queryFn: () => getTracking(orderId), refetchInterval: 30_000 })
  const tracking = t.data
  const trackingRef = useRef(tracking)
  useEffect(() => { trackingRef.current = tracking }, [tracking])

  const maybeRoute = useCallback(async (leg: 'coleta' | 'entrega', pos: LngLat) => {
    const cur = trackingRef.current
    const r = cur?.route && cur.route.leg === leg ? cur.route : null
    const now = Date.now()
    let need = !r && routeAsk.current.leg !== leg
    if (r) {
      const p = routeProgress(pos, r.geometry)
      routeAsk.current.offCount = p && p.offRouteM > OFF_ROUTE_M ? routeAsk.current.offCount + 1 : 0
      need = routeAsk.current.offCount >= 2 && now - routeAsk.current.at > 120_000
    }
    if (!need) return
    routeAsk.current = { at: now, leg, offCount: 0 }
    try {
      await requestRoute(orderId, leg)
      void qc.invalidateQueries({ queryKey: ['rastreio', orderId] })
    } catch {
      // sem rota no mapa (limite, sem chave, sem coordenadas): o Google Maps continua disponível
    }
  }, [orderId, qc])

  const stop = useCallback((tellServer = true) => {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current)
    watch.current = null
    last.current = null
    void wake.current?.release().catch(() => undefined)
    wake.current = null
    setOn(false)
    if (tellServer) void stopSharing(orderId).catch(() => undefined)
  }, [orderId])

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) { setState((s) => ({ ...s, error: 'Este aparelho não informa a localização.' })); return }
    setOn(true)
    setState((s) => ({ ...s, error: null }))
    void nav().wakeLock?.request('screen').then((w) => { wake.current = w }).catch(() => undefined)
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        const pos: LngLat = [p.coords.longitude, p.coords.latitude]
        const now = Date.now()
        setState((s) => ({ ...s, accuracy: p.coords.accuracy, error: null }))
        if (sending.current || !shouldSend(last.current, now, pos)) return
        sending.current = true
        last.current = { at: now, pos }
        sendLocation(orderId, {
          lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy,
          heading: Number.isFinite(p.coords.heading) ? p.coords.heading : null,
          speedKmh: Number.isFinite(p.coords.speed) && p.coords.speed !== null ? p.coords.speed * 3.6 : null, at: p.timestamp || now,
        })
          .then((leg) => { setState((s) => ({ ...s, sentAt: Date.now() })); void maybeRoute(leg, pos) })
          .catch((e: unknown) => {
            const m = e instanceof Error ? e.message : 'Falha ao enviar a localização.'
            setState((s) => ({ ...s, error: m }))
            if (/não está atribuída|já terminou/i.test(m)) stop(false)
          })
          .finally(() => { sending.current = false })
      },
      (e) => setState((s) => ({ ...s, error: e.code === 1 ? 'Permissão de localização negada. Libere nas configurações do navegador.' : 'Sem sinal de GPS no momento.' })),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    )
  }, [orderId, maybeRoute, stop])

  // tela bloqueada/app em segundo plano: avisa; ao voltar, pede a tela acesa de novo
  useEffect(() => {
    const onVis = () => {
      const hidden = document.visibilityState === 'hidden'
      setState((s) => ({ ...s, hidden }))
      if (!hidden && watch.current !== null && !wake.current) void nav().wakeLock?.request('screen').then((w) => { wake.current = w }).catch(() => undefined)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])
  // entrega terminou (componente some): para o GPS; o banco já apagou a posição
  useEffect(() => () => {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current)
    void wake.current?.release().catch(() => undefined)
  }, [])

  const leg = tracking?.leg ?? null
  const dest = leg === 'coleta'
    ? googleMapsRoute(tracking?.business.lat != null && tracking.business.lng != null ? { lat: tracking.business.lat, lng: tracking.business.lng } : null, pickupAddress)
    : googleMapsRoute(tracking?.destination ?? null, dropoffAddress)
  const sentAgo = state.sentAt ? Math.round((Date.now() - state.sentAt) / 1000) : null

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
      {dest && (
        <a href={dest} target="_blank" rel="noopener noreferrer" className="pressable inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand px-5 text-base font-semibold text-surface">
          <Navigation aria-hidden="true" className="size-5" />{leg === 'entrega' ? 'Rota até o cliente no Google Maps' : 'Rota até a loja no Google Maps'}
        </a>
      )}
      {on ? (
        <>
          <p role="status" className="flex items-center gap-2 text-sm font-semibold text-success">
            <span aria-hidden="true" className="size-2.5 animate-pulse rounded-full bg-success" />
            Compartilhando localização ao vivo{sentAgo !== null ? ` · enviada há ${sentAgo} s` : ' · aguardando GPS…'}
            {state.accuracy !== null && <span className="font-normal text-ink-muted">(precisão ~{Math.round(state.accuracy)} m)</span>}
          </p>
          <button type="button" onClick={() => stop()} className="pressable inline-flex min-h-11 w-fit items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-ink">
            <Square aria-hidden="true" className="size-4" />Parar de compartilhar
          </button>
        </>
      ) : (
        <button type="button" onClick={start} className="pressable inline-flex min-h-12 items-center justify-center gap-2 rounded-full border-2 border-brand px-5 text-base font-semibold text-ink">
          <Radio aria-hidden="true" className="size-5" />Compartilhar localização ao vivo
        </button>
      )}
      {state.error && <p role="alert" className="text-sm font-semibold text-danger">{state.error}</p>}
      <p className="text-xs text-ink-muted">
        {state.hidden && on ? 'O app está em segundo plano: o navegador pode pausar o envio até você voltar para esta tela. ' : ''}
        O cliente vê sua posição só durante esta entrega (aproximada até a retirada). Mantenha esta tela aberta: com a tela bloqueada o navegador pode parar de enviar.
      </p>
    </div>
  )
}
