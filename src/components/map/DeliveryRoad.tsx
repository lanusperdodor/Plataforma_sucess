import { Home, Store } from 'lucide-react'
import { haversine, type LngLat } from '../../features/rastreamento/geo.ts'

/** Pontos da pista: saída do entregador (0) → loja (STORE_AT) → casa do cliente (1). */
export const STORE_AT = 0.38

export type RoadStage = 'preparando' | 'coleta' | 'entrega'
export interface RoadState { stage: RoadStage; progress: number; moving: boolean }

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/**
 * Onde a motinha fica na pista. Usa a posição REAL do entregador quando existe (distância restante pela rota ou em
 * linha reta até o próximo ponto); sem posição, usa a etapa do pedido (sem inventar distância nem previsão).
 */
export function roadState(input: {
  leg: 'coleta' | 'entrega' | null
  position: LngLat | null
  business: LngLat | null
  destination: LngLat | null
  remainingM: number | null
  routeDistanceM: number | null
  live: boolean
}): RoadState {
  const { leg, position, business, destination, remainingM, routeDistanceM, live } = input
  if (!leg) return { stage: 'preparando', progress: STORE_AT, moving: false }
  // fração percorrida da etapa atual
  let frac: number | null = null
  if (remainingM !== null && routeDistanceM && routeDistanceM > 0) frac = 1 - remainingM / routeDistanceM
  else if (position) {
    const target = leg === 'coleta' ? business : destination
    const from = leg === 'coleta' ? null : business
    if (target && from) {
      const total = haversine(from, target)
      if (total > 0) frac = 1 - haversine(position, target) / total
    } else if (target) {
      // indo para a loja sem saber de onde saiu: até 3 km do ponto, aproxima
      frac = 1 - Math.min(haversine(position, target), 3000) / 3000
    }
  }
  const f = clamp(frac ?? (leg === 'coleta' ? 0.45 : 0.25), 0.04, 0.96)
  const progress = leg === 'coleta' ? STORE_AT * f : STORE_AT + (1 - STORE_AT) * f
  return { stage: leg, progress, moving: live || !position }
}

/** Motinha de entrega (lado), com baú laranja da Tucaí. Desenhada em SVG, sem imagens externas. */
function Moto({ moving }: { moving: boolean }) {
  const spin = moving ? 'tucai-wheel-spin' : ''
  return (
    <svg viewBox="0 0 64 44" width="88" height="61" aria-hidden="true" className="drop-shadow-sm">
      {/* fumacinha */}
      {moving && <circle cx="6" cy="34" r="3" className="tucai-puff fill-[#9ca3af]" />}
      {/* rodas */}
      <g className={spin}><circle cx="15" cy="34" r="7" className="fill-[#1f2326] stroke-white/70" strokeWidth="1" /><circle cx="15" cy="34" r="2.5" className="fill-[#e5e7eb]" /><path d="M15 27v14M8 34h14" className="stroke-[#e5e7eb]/50" strokeWidth="1.2" /></g>
      <g className={spin}><circle cx="49" cy="34" r="7" className="fill-[#1f2326] stroke-white/70" strokeWidth="1" /><circle cx="49" cy="34" r="2.5" className="fill-[#e5e7eb]" /><path d="M49 27v14M42 34h14" className="stroke-[#e5e7eb]/50" strokeWidth="1.2" /></g>
      {/* corpo da moto */}
      <path d="M12 30c3-6 9-8 16-8h10l6 8h6l-2 4H22c-2-3-6-4-10-4z" className="fill-orange" />
      <path d="M44 30l4-12h4" className="stroke-[#1f2326]" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      {/* baú de entrega */}
      <rect x="6" y="10" width="15" height="13" rx="2" className="fill-orange stroke-[#1f2326]" strokeWidth="1.5" />
      <path d="M8.5 14.5h10" className="stroke-white" strokeWidth="1.5" strokeLinecap="round" />
      {/* entregador com capacete */}
      <path d="M26 22l5-9h6l3 9" className="fill-[#374151] stroke-white" strokeWidth="1" strokeLinejoin="round" />
      <circle cx="35" cy="8" r="5.5" className="fill-orange stroke-[#1f2326]" strokeWidth="1.5" />
      <path d="M36 6h4v3h-4z" className="fill-[#1f2326]" />
      <path d="M37 15l7 5" className="stroke-[#374151]" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

function Point({ at, icon: Icon, label, active }: { at: number; icon: typeof Store; label: string; active: boolean }) {
  return (
    <div className="absolute bottom-10 flex -translate-x-1/2 flex-col items-center" style={{ left: `${at * 100}%` }}>
      <span className="mb-1 max-w-28 truncate whitespace-nowrap rounded-full bg-surface/90 px-2 py-0.5 text-xs font-semibold text-ink shadow-sm sm:max-w-40">{label}</span>
      <span className={`grid size-10 place-items-center rounded-2xl border-2 shadow-sm ${active ? 'border-brand bg-brand text-surface' : 'border-line bg-surface text-ink'}`}>
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <span aria-hidden="true" className="h-12 w-0.5 bg-ink/30" />
    </div>
  )
}

/** Pista estilizada: entregador → loja → casa, com a motinha andando. */
export function DeliveryRoad({ state, label, storeName, customerLabel }: { state: RoadState; label: string; storeName: string; customerLabel: string }) {
  const { progress, moving, stage } = state
  // posição na tela: margem de 5% à esquerda e casa a 92%
  const x = (p: number) => 0.05 + p * 0.87
  return (
    <div role="img" aria-label={label} className="relative h-56 overflow-hidden rounded-card border border-line bg-gradient-to-b from-muted to-surface sm:h-60">
      {/* nuvens discretas */}
      <span aria-hidden="true" className="absolute left-[12%] top-5 h-3 w-14 rounded-full bg-surface/80" />
      <span aria-hidden="true" className="absolute left-[60%] top-8 h-3 w-20 rounded-full bg-surface/70" />
      <span aria-hidden="true" className="absolute left-[82%] top-4 h-2.5 w-10 rounded-full bg-surface/80" />
      {/* estrada */}
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-10 bg-[#2d3135]">
        <div className={`tucai-road absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 opacity-70 ${moving ? 'tucai-road-moving' : ''}`} />
      </div>
      {/* trecho já percorrido */}
      <div aria-hidden="true" className="absolute bottom-10 left-0 h-1.5 rounded-r-full bg-orange transition-[width] duration-1000 ease-out" style={{ width: `${x(progress) * 100}%` }} />
      <Point at={x(STORE_AT)} icon={Store} label={storeName} active={stage !== 'entrega'} />
      <Point at={x(1)} icon={Home} label={customerLabel} active={stage === 'entrega'} />
      {/* motinha */}
      <div className="absolute bottom-6 -translate-x-1/2 transition-[left] duration-1000 ease-out" style={{ left: `${x(progress) * 100}%` }} data-testid="motinha">
        <div className={moving ? 'tucai-moto-bob' : ''}><Moto moving={moving} /></div>
      </div>
    </div>
  )
}
