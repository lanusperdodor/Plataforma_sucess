import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Navigation, Radio, RotateCcw, Square, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { shouldSend, type LngLat } from '../../features/rastreamento/geo.ts'
import { courierSetPointFromAddress, geocodeAddress, getRouteSteps, getTracking, requestRoute, sendLocation, stopSharing, toLngLat } from '../../features/rastreamento/repository.ts'
import { CourierNavigation, type GpsFix } from '../../components/map/CourierNavigation.tsx'
import { getMyCourierAddress } from '../../features/address/repository.ts'
import { formatAddress } from '../../features/address/address.ts'

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
  const fixRef = useRef<GpsFix | null>(null)
  fixRef.current = fix
  const [routeUi, setRouteUi] = useState<{ recalculating: boolean; error: string | null }>({ recalculating: false, error: null })
  const [state, setState] = useState<{ sentAt: number | null; error: string | null; accuracy: number | null; hidden: boolean }>({ sentAt: null, error: null, accuracy: null, hidden: false })
  const watch = useRef<number | null>(null)
  const last = useRef<{ at: number; pos: LngLat } | null>(null)
  const sending = useRef(false)
  const wake = useRef<WakeLockLike | null>(null)
  const t = useQuery({ queryKey: ['rastreio', orderId], queryFn: () => getTracking(orderId), refetchInterval: 30_000 })
  const tracking = t.data
  const trackingRef = useRef(tracking)
  useEffect(() => { trackingRef.current = tracking }, [tracking])

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
          .then(() => { setState((s) => ({ ...s, sentAt: Date.now() })) })
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
  }, [orderId, stop])

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
  // cliente não marcou o ponto no mapa: localiza pelo endereço digitado (uma vez) e libera a rota até ele
  const geoTried = useRef(false)
  useEffect(() => {
    if (!showMap || geoTried.current || !tracking || tracking.destination || !dropoffAddress || leg === null) return
    geoTried.current = true
    const near = tracking.business.lat != null && tracking.business.lng != null ? { lat: tracking.business.lat, lng: tracking.business.lng } : null
    void geocodeAddress(dropoffAddress, near)
      .then((p) => courierSetPointFromAddress(orderId, p.lat, p.lng))
      .then(() => { void qc.invalidateQueries({ queryKey: ['rastreio', orderId] }) })
      .catch((e: unknown) => {
        if (leg === 'entrega') setRouteUi((r) => ({ ...r, error: `Não achamos o endereço do cliente no mapa (${e instanceof Error ? e.message : 'erro'}). Ligue para o cliente ou use o link abaixo.` }))
      })
  }, [showMap, tracking, dropoffAddress, leg, orderId, qc])
  // ponto de partida da coleta: GPS agora; sem GPS, o endereço cadastrado do entregador
  const startPoint = useCallback(async (): Promise<{ lat: number; lng: number } | null> => {
    const gps = await new Promise<{ lat: number; lng: number } | null>((resolve) => {
      if (!('geolocation' in navigator) || typeof navigator.geolocation.getCurrentPosition !== 'function') return resolve(null)
      navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(null),
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 })
    })
    if (gps) return gps
    if (fixRef.current) return { lat: fixRef.current.pos[1], lng: fixRef.current.pos[0] }
    const parts = await getMyCourierAddress()
    if (!parts) return null
    const cur = trackingRef.current
    const near = cur?.business.lat != null && cur.business.lng != null ? { lat: cur.business.lat, lng: cur.business.lng } : null
    return geocodeAddress(formatAddress(parts), near).catch(() => null)
  }, [])

  // botão único da etapa: "até o restaurante" (do entregador até a loja) → depois de pegar, "até o cliente" (da loja até o cliente)
  const [routing, setRouting] = useState(false)
  const trace = useCallback(async () => {
    if (!leg || routing) return
    setShowMap(true)
    if (!on) start()
    setRouting(true)
    setRouteUi({ recalculating: false, error: null })
    try {
      const cur = trackingRef.current
      if (leg === 'coleta' && cur && (cur.business.lat == null || cur.business.lng == null)) {
        throw new Error('O restaurante ainda não marcou o endereço no mapa. Use o link “Abrir a rota no OpenStreetMap” abaixo ou ligue para a loja.')
      }
      // cliente ainda sem ponto no mapa: localiza pelo endereço digitado ANTES de traçar (senão a rota falha)
      if (leg === 'entrega' && cur && !cur.destination && dropoffAddress) {
        geoTried.current = true
        const near = cur.business.lat != null && cur.business.lng != null ? { lat: cur.business.lat, lng: cur.business.lng } : null
        const p = await geocodeAddress(dropoffAddress, near).catch(() => null)
        if (!p) throw new Error('Não achamos o endereço do cliente no mapa. Ligue para o cliente ou use o link abaixo.')
        await courierSetPointFromAddress(orderId, p.lat, p.lng)
      }
      const from = leg === 'coleta' ? await startPoint() : null
      if (leg === 'coleta' && !from) throw new Error('Não conseguimos sua localização. Ligue o GPS ou cadastre seu endereço em Meus dados.')
      await requestRoute(orderId, leg, from)
      await qc.invalidateQueries({ queryKey: ['rastreio', orderId] })
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Rota não encontrada.'
      // tocou duas vezes seguidas: a rota já traçada continua valendo
      if (/acabou de ser traçada|acabou de ser calculada/i.test(m)) { void qc.invalidateQueries({ queryKey: ['rastreio', orderId] }); setRouteUi({ recalculating: false, error: null }) }
      else setRouteUi({ recalculating: false, error: m })
    } finally {
      setRouting(false)
    }
  }, [leg, routing, on, start, startPoint, orderId, qc, dropoffAddress])

  const steps = useQuery({
    queryKey: ['rastreio', 'passos', orderId, tracking?.route?.computed_at ?? ''],
    queryFn: () => getRouteSteps(orderId),
    enabled: showMap && !!tracking?.route,
    staleTime: Infinity,
  })
  const store = tracking?.business.lat != null && tracking.business.lng != null ? toLngLat({ lat: tracking.business.lat, lng: tracking.business.lng }) : null
  const destination = tracking?.destination ? toLngLat(tracking.destination) : null
  const hasRoute = !!tracking?.route && tracking.route.leg === leg
  const sentAgo = state.sentAt ? Math.round((Date.now() - state.sentAt) / 1000) : null

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
      {/* um botão só, no mesmo lugar: muda conforme a etapa (restaurante → cliente) */}
      {leg && (
        <button type="button" disabled={routing} onClick={() => void trace()}
          className="pressable inline-flex min-h-14 items-center justify-center gap-2 rounded-full bg-brand px-5 text-lg font-bold text-surface disabled:opacity-70">
          {routing ? <Loader2 aria-hidden="true" className="size-5 animate-spin" /> : hasRoute ? <RotateCcw aria-hidden="true" className="size-5" /> : <Navigation aria-hidden="true" className="size-5" />}
          {routing ? 'Traçando a rota…' : `${hasRoute ? 'Traçar de novo' : 'Traçar rota'} até ${leg === 'entrega' ? 'o cliente' : 'o restaurante'}`}
        </button>
      )}
      <p className="text-sm text-ink-muted">
        {leg === 'entrega'
          ? `Rota do restaurante (${pickupName}) até o cliente (${dropoffName}).`
          : leg === 'coleta' ? `Rota de onde você está até o restaurante (${pickupName}). Depois de “Peguei o pedido”, o botão muda para a rota até o cliente.` : ''}
      </p>
      {hasRoute && !showMap && (
        <button type="button" onClick={() => { if (!on) start(); setShowMap(true) }} className="pressable inline-flex min-h-12 items-center justify-center gap-2 rounded-full border-2 border-brand px-5 text-base font-semibold text-ink">
          <Navigation aria-hidden="true" className="size-5" />Abrir o mapa da rota
        </button>
      )}
      {showMap && (
        <button type="button" onClick={() => setShowMap(false)} className="pressable inline-flex min-h-11 w-fit items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-ink">
          <X aria-hidden="true" className="size-4" />Fechar o mapa
        </button>
      )}
      {showMap && (
        <CourierNavigation
          leg={leg} vehicle={tracking?.vehicle ?? 'moto'} fix={fix} store={store} destination={leg === 'entrega' ? destination : null}
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
