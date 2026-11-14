import { ArrowUp, ArrowUpLeft, ArrowUpRight, CornerUpLeft, CornerUpRight, Flag, LocateFixed, MapPin, Navigation, RefreshCw, RotateCcw, Route, SignalLow, Utensils, WifiOff } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { formatBRL } from '../../lib/money.ts'
import { estimate, formatDistance, haversine, nextStep, osmDirections, roughEtaMin, type LngLat, type NavStep } from '../../features/rastreamento/geo.ts'

const NavigationMap = lazy(() => import('./NavigationMap.tsx'))

const TURN_ICON: Record<string, typeof ArrowUp> = {
  'turn-left': CornerUpLeft, 'turn-right': CornerUpRight, 'sharp-left': CornerUpLeft, 'sharp-right': CornerUpRight,
  'slight-left': ArrowUpLeft, 'slight-right': ArrowUpRight, 'keep-left': ArrowUpLeft, 'keep-right': ArrowUpRight,
  uturn: RotateCcw, roundabout: RefreshCw, 'roundabout-exit': ArrowUpRight, arrive: Flag, depart: ArrowUp, straight: ArrowUp,
}

export interface GpsFix { pos: LngLat; heading: number | null; accuracy: number | null; at: number }
export interface NavRoute { geometry: LngLat[]; distance_m: number; duration_s: number; computed_at: string }

export interface CourierNavigationProps {
  leg: 'coleta' | 'entrega' | null
  vehicle: string
  fix: GpsFix | null
  store: LngLat | null
  destination: LngLat | null
  route: NavRoute | null
  steps: NavStep[]
  pickup: { name: string; address: string | null }
  dropoff: { name: string; address: string | null }
  payCents: number | null
  /** total da entrega (loja → cliente) calculado no servidor, quando houver */
  deliveryDistanceM: number | null
  recalculating: boolean
  routeError: string | null
  gpsError: string | null
  sharing: boolean
}

function useOnline() {
  const [on, setOn] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  useEffect(() => {
    const up = () => setOn(true), down = () => setOn(false)
    window.addEventListener('online', up); window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  return on
}

function useDark() {
  const read = () => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
  const [dark, setDark] = useState(read)
  useEffect(() => {
    const o = new MutationObserver(() => setDark(read()))
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => o.disconnect()
  }, [])
  return dark
}

/** Navegação do entregador: mapa com a rota real pelas ruas, próxima conversão, distância e tempo restantes. */
export function CourierNavigation(p: CourierNavigationProps) {
  const online = useOnline()
  const dark = useDark()
  const [follow, setFollow] = useState(true)
  const target = p.leg === 'entrega' ? p.destination : p.store
  const pos = p.fix?.pos ?? null
  // distância e tempo: pela rota (posição perto dela); sem rota, em linha reta até o destino da etapa (marcado como aproximado)
  const est = pos && p.route ? estimate(pos, new Date(p.fix!.at).toISOString(), p.route) : null
  const straight = !est && pos && target ? haversine(pos, target) : null
  const remainingM = est?.remainingM ?? straight
  const etaMin = est?.etaMin ?? (straight !== null ? roughEtaMin(straight * 1.3, p.vehicle) : null)
  const next = est && p.route ? nextStep(p.steps, p.route.distance_m, est.remainingM) : null
  const TurnIcon = next ? TURN_ICON[next.step.type] ?? ArrowUp : Navigation
  const place = p.leg === 'entrega' ? p.dropoff : p.pickup
  const stage = p.leg === 'entrega' ? 1 : 0
  const fallback = osmDirections(pos ? { lat: pos[1], lng: pos[0] } : null, target ? { lat: target[1], lng: target[0] } : null)
  const label = `Mapa da navegação. ${p.leg === 'entrega' ? 'Indo para a entrega' : 'Indo para a coleta'}${remainingM !== null ? `, faltam ${formatDistance(remainingM)}` : ''}${etaMin !== null ? `, cerca de ${etaMin} minutos` : ''}.`

  return (
    <section aria-labelledby="nav-titulo" className="flex flex-col overflow-hidden rounded-card border border-line bg-surface">
      <h2 id="nav-titulo" className="sr-only">Navegação da entrega</h2>
      {/* mapa */}
      <div className="relative h-[55vh] min-h-80 w-full bg-muted sm:h-[60vh]">
        <Suspense fallback={<div className="h-full w-full animate-pulse bg-muted" aria-hidden="true" />}>
          <NavigationMap vehicle={p.vehicle} position={pos} heading={p.fix?.heading ?? null} store={p.store} destination={p.destination}
            route={p.route?.geometry ?? null} follow={follow} onUserMove={() => setFollow(false)} dark={dark} label={label} />
        </Suspense>
        {/* próxima conversão */}
        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col gap-2">
          {!online && (
            <p role="alert" className="flex items-center gap-2 rounded-2xl bg-danger px-4 py-2 text-sm font-semibold text-white shadow-lg"><WifiOff aria-hidden="true" className="size-4" />Sem internet. O GPS continua; a posição é enviada quando a conexão voltar.</p>
          )}
          {p.recalculating ? (
            <p role="status" className="flex items-center gap-2 rounded-2xl bg-[#111317] px-4 py-3 text-sm font-semibold text-white shadow-lg"><RefreshCw aria-hidden="true" className="size-5 animate-spin" />Recalculando a rota…</p>
          ) : next ? (
            <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-2xl bg-[#111317] px-4 py-3 text-white shadow-lg">
              <TurnIcon aria-hidden="true" className="size-8 shrink-0 text-[#ff7a00]" />
              <div className="min-w-0">
                <p className="text-lg font-bold leading-tight">{next.step.type === 'arrive' ? 'Chegando' : `Em ${formatDistance(next.inM)}`}</p>
                <p className="truncate text-sm opacity-90">{next.step.text}</p>
              </div>
            </div>
          ) : null}
        </div>
        <button type="button" onClick={() => setFollow(true)} aria-pressed={follow} aria-label="Centralizar no meu local"
          className={`pressable absolute bottom-4 right-3 grid size-12 place-items-center rounded-full border border-line shadow-lg ${follow ? 'bg-brand text-surface' : 'bg-surface text-ink'}`}>
          <LocateFixed aria-hidden="true" className="size-5" />
        </button>
      </div>

      {/* painel inferior */}
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span aria-hidden="true" className={`grid size-10 shrink-0 place-items-center rounded-full text-white ${p.leg === 'entrega' ? 'bg-[#e5383b]' : 'bg-[#ff7a00]'}`}>
              {p.leg === 'entrega' ? <MapPin className="size-5" /> : <Utensils className="size-5" />}
            </span>
            <div className="min-w-0">
              <p className="text-sm text-ink-muted">{p.leg === 'entrega' ? 'Indo para a entrega' : 'Indo para a coleta'}</p>
              <p className="truncate text-lg font-bold text-ink">{place.name}</p>
              {place.address && <p className="text-sm text-ink-muted">{place.address}</p>}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xl font-bold tabular-nums text-ink">{remainingM !== null ? formatDistance(remainingM) : '—'}</p>
            <p className="text-base font-semibold tabular-nums text-ink">{etaMin !== null ? `${etaMin} min` : '—'}</p>
            {!est && straight !== null && <p className="text-xs text-ink-muted">aproximado</p>}
          </div>
        </div>

        <ol aria-label="Etapas" className="grid grid-cols-3 text-center text-sm">
          {['Coleta', 'Entrega', 'Finalizar'].map((s, i) => (
            <li key={s} aria-current={i === stage ? 'step' : undefined} className="flex flex-col items-center gap-1">
              <span aria-hidden="true" className={`size-4 rounded-full border-2 ${i < stage ? 'border-success bg-success' : i === stage ? 'border-brand bg-brand ring-4 ring-brand/20' : 'border-line bg-surface'}`} />
              <span className={i === stage ? 'font-semibold text-ink' : 'text-ink-muted'}>{s}</span>
            </li>
          ))}
        </ol>

        {(p.gpsError || !p.sharing) && (
          <p role="alert" className="flex items-start gap-2 rounded-xl bg-muted p-3 text-sm text-ink"><SignalLow aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{p.gpsError ?? 'Ative "Compartilhar localização" para navegar e o cliente acompanhar.'}</p>
        )}
        {p.routeError && (
          <div role="status" className="flex flex-col gap-2 rounded-xl bg-muted p-3 text-sm text-ink">
            <p>{p.routeError}</p>
            {fallback && <a href={fallback} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand underline">Abrir a rota no OpenStreetMap</a>}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-line p-3 text-sm text-ink">
          <span className="inline-flex items-center gap-1.5 font-semibold"><Route aria-hidden="true" className="size-4" />Rota da etapa</span>
          <span className="tabular-nums">{p.route ? formatDistance(p.route.distance_m) : '—'}</span>
          <span className="tabular-nums">{p.route ? `${Math.max(1, Math.round(p.route.duration_s / 60))} min` : ''}</span>
          {p.deliveryDistanceM ? <span className="tabular-nums text-ink-muted">Entrega: {formatDistance(p.deliveryDistanceM)}</span> : null}
          {p.payCents !== null && <span className="ml-auto font-bold tabular-nums text-success">{formatBRL(p.payCents)}</span>}
        </div>
      </div>
    </section>
  )
}
