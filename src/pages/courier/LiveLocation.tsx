import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigation, Radio, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { routeProgress, shouldSend, OFF_ROUTE_M, type LngLat } from '../../features/rastreamento/geo.ts'
import { getRouteSteps, getTracking, requestRoute, sendLocation, stopSharing, toLngLat } from '../../features/rastreamento/repository.ts'
import { CourierNavigation, type GpsFix } from '../../components/map/CourierNavigation.tsx'

type WakeLockLike = { release(): Promise<void> }
const nav = () => navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockLike> } }

/**
 * Compartilhamento da localização REAL do entregador durante uma entrega. Só começa quando ele toca no botão
 * (o navegador pede a permissão). Envia a cada ~20 s (antes, se andou bastante), mantém a tela acesa quando o
 * aparelho permite e para sozinho quando a entrega termina (o componente sai da tela e o banco apaga a posição).
 * Navegadores costumam pausar o GPS com a tela bloqueada ou o app em segundo plano: isso é avisado, não prometido.
 */
export function LiveLocation({ orderId, pickupAddress, dropoffAddress, pickupName = 'Loja', dropoffName = 'Cliente', payCents = null }: {
  orderId: string; pickupAddress: string | null; dropoffAddress: string | null; pickupName?: string; dropoffName?: string; payCents?: number | null
}) {
  const qc = useQueryClient()
  const [on, setOn] = useState(false)
  const [showMap, setShowMap] = useState(false)
  // posição precisa do próprio aparelho (só para a tela do entregador; o servidor recebe a cada ~20 s)
  const [fix, setFix] = useState<GpsFix | null>(null)
  const [routeUi, setRouteUi] = useState<{ recalculating: boolean; error: string | null }>({ recalculating: false, error: null })
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
    const recalculo = !!r
    routeAsk.current = { at: now, leg, offCount: 0 }
    setRouteUi({ recalculating: recalculo, error: null })
    try {
      await requestRoute(orderId, leg)
      void qc.invalidateQueries({ queryKey: ['rastreio', orderId] })
      setRouteUi({ recalculating: false, error: null })
    } catch (e) {
      // sem rota (limite, sem chave, sem coordenadas, rua não encontrada): a navegação segue com a linha reta e o link do OpenStreetMap
      setRouteUi({ recalculating: false, error: e instanceof Error ? e.message : 'Rota não encontrada.' })
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
        setFix({ pos, heading: Number.isFinite(p.coords.heading) && p.coords.heading !== null && (p.coords.speed ?? 0) > 0.5 ? p.coords.heading : null, accuracy: p.coords.accuracy, at: now })
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
  const steps = useQuery({
    queryKey: ['rastreio', 'passos', orderId, tracking?.route?.computed_at ?? ''],
    queryFn: () => getRouteSteps(orderId),
    enabled: showMap && !!tracking?.route,
    staleTime: Infinity,
  })
  const store = tracking?.business.lat != null && tracking.business.lng != null ? toLngLat({ lat: tracking.business.lat, lng: tracking.business.lng }) : null
  const destination = tracking?.destination ? toLngLat(tracking.destination) : null
  const sentAgo = state.sentAt ? Math.round((Date.now() - state.sentAt) / 1000) : null

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
      {/* navegação DENTRO da Tucaí: mapa OpenStreetMap, rota pelas ruas e próxima conversão. Abrir já liga o GPS. */}
      <button type="button" onClick={() => { if (!showMap && !on) start(); setShowMap((v) => !v) }} aria-expanded={showMap}
        className="pressable inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand px-5 text-base font-semibold text-surface">
        <Navigation aria-hidden="true" className="size-5" />{showMap ? 'Fechar navegação' : leg === 'entrega' ? 'Navegar até o cliente' : 'Navegar até a loja'}
      </button>
      {showMap && (
        <CourierNavigation
          leg={leg} vehicle={tracking?.vehicle ?? 'moto'} fix={fix} store={store} destination={destination}
          route={tracking?.route && tracking.route.leg === leg ? tracking.route : null} steps={steps.data ?? []}
          pickup={{ name: pickupName, address: pickupAddress }} dropoff={{ name: dropoffName, address: dropoffAddress }}
          payCents={payCents} deliveryDistanceM={null}
          recalculating={routeUi.recalculating} routeError={routeUi.error} gpsError={state.error} sharing={on}
        />
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
