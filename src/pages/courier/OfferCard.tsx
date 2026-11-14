import { Bike, Check, MapPin, Utensils, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { DeliveryOffer } from '../../features/courier/repository.ts'
import { formatDistance, haversine, roughEtaMin, type LngLat } from '../../features/rastreamento/geo.ts'
import { formatBRL } from '../../lib/money.ts'

/**
 * Posição aproximada do aparelho para estimar a distância até a coleta. Só consulta se a permissão de localização
 * JÁ foi dada (nunca abre o pedido de permissão só por listar ofertas) e não envia nada ao servidor.
 */
export function useApproxPosition(active: boolean): LngLat | null {
  const [pos, setPos] = useState<LngLat | null>(null)
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !navigator.geolocation || !navigator.permissions?.query) return
    let alive = true
    void navigator.permissions.query({ name: 'geolocation' as PermissionName }).then((st) => {
      if (!alive || st.state !== 'granted') return
      navigator.geolocation.getCurrentPosition((p) => { if (alive) setPos([p.coords.longitude, p.coords.latitude]) }, () => undefined, { enableHighAccuracy: false, maximumAge: 120_000, timeout: 10_000 })
    }).catch(() => undefined)
    return () => { alive = false }
  }, [active])
  return pos
}

/** Card de oferta: ganho em destaque, distância e tempo, coleta → entrega e Aceitar / Rejeitar. */
export function OfferCard({ o, vehicle, me, status, deadline, onAccept, onReject, busy }: {
  o: DeliveryOffer; vehicle: string; me: LngLat | null; status: string | null; deadline: ReactNode
  onAccept: () => void; onReject: () => void; busy: boolean
}) {
  const toStore = me && o.store ? haversine(me, o.store) * 1.3 : null   // linha reta × 1,3 ≈ ruas (estimativa)
  const total = o.deliveryDistanceM !== null ? o.deliveryDistanceM + (toStore ?? 0) : null
  const min = total !== null ? roughEtaMin(total, vehicle) : null
  return (
    <li className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="inline-flex rounded-full bg-danger px-2.5 py-0.5 text-xs font-bold text-white">Nova oferta{o.city ? ` · ${o.city}` : ''}</span>
          <p className="mt-1 text-3xl font-bold tabular-nums text-ink">{formatBRL(o.payCents)}</p>
          <p className="flex items-center gap-1.5 text-sm text-ink">
            <Bike aria-hidden="true" className="size-4" />
            {total !== null ? <><strong className="tabular-nums">{formatDistance(total)}</strong> · cerca de <strong className="tabular-nums">{min} min</strong></> : 'Distância informada após o cálculo do frete'}
          </p>
          {o.deliveryDistanceM !== null && (
            <p className="text-xs text-ink-muted">
              Entrega {formatDistance(o.deliveryDistanceM)} pelas ruas{toStore !== null ? ` + cerca de ${formatDistance(toStore)} até a loja (estimado do seu local)` : ''}
            </p>
          )}
        </div>
        {deadline}
      </div>
      <ol className="flex flex-col gap-2 text-sm">
        <li className="flex items-start gap-2">
          <span aria-hidden="true" className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[#ff7a00] text-white"><Utensils className="size-3.5" /></span>
          <span><strong className="text-ink">Coleta: {o.businessName}</strong>{o.businessAddress && <span className="block text-ink-muted">{o.businessAddress}</span>}{status && <span className="block text-ink-muted">{status}</span>}</span>
        </li>
        <li className="flex items-start gap-2">
          <span aria-hidden="true" className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-success text-white"><MapPin className="size-3.5" /></span>
          <span><strong className="text-ink">Entrega: {o.neighborhood ?? 'bairro informado após aceitar'}</strong><span className="block text-ink-muted">{o.itemsCount} {o.itemsCount === 1 ? 'item' : 'itens'} · endereço completo após aceitar</span></span>
        </li>
      </ol>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} onClick={onReject} className="pressable inline-flex min-h-12 items-center justify-center gap-2 rounded-full border-2 border-line font-semibold text-ink disabled:opacity-60">
          <X aria-hidden="true" className="size-5" />Rejeitar
        </button>
        <button type="button" disabled={busy} onClick={onAccept} className="pressable inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand font-semibold text-surface disabled:opacity-60">
          <Check aria-hidden="true" className="size-5" />Aceitar
        </button>
      </div>
    </li>
  )
}
