import { Bike, CircleCheck, CircleX, Clock, Flame, Star, Store, Utensils } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Img } from '../feedback/Img'
import { formatBRL } from '../../lib/money'
import type { BusinessSummary } from '../../features/catalog/schemas'

export interface BusinessCardProps {
  business: BusinessSummary
  categoryLabel?: string
  /** Selo quente. Só deve vir de campanhas reais; nunca inventar. */
  promotion?: { label: string }
  layout?: 'grid' | 'row'
}

function formatKm(km: number): string {
  return km.toFixed(1).replace('.', ',')
}

export function businessHref(b: Pick<BusinessSummary, 'businessType' | 'slug'>): string {
  const base = b.businessType === 'restaurante' ? '/restaurantes' : b.businessType === 'loja' ? '/lojas' : '/servicos'
  return `${base}/${b.slug}`
}

export function deliveryText(b: Pick<BusinessSummary, 'deliveryOffer' | 'ownDeliveryFeeCents'>): string {
  if (b.deliveryOffer === 'partner') return 'Entrega parceira'
  if (b.deliveryOffer === 'own') {
    return b.ownDeliveryFeeCents > 0 ? `Entrega própria ${formatBRL(b.ownDeliveryFeeCents)}` : 'Entrega própria grátis'
  }
  return 'Só retirada'
}

export function timeText(min: number | null, max: number | null): string | null {
  if (min != null && max != null) return min === max ? `${min} min` : `${min}–${max} min`
  const one = min ?? max
  return one != null ? `${one} min` : null
}

export function BusinessCard({ business: b, categoryLabel, promotion, layout = 'grid' }: BusinessCardProps) {
  const isRow = layout === 'row'
  const time = timeText(b.estimatedMinMinutes, b.estimatedMaxMinutes)
  const FallbackIcon = b.businessType === 'restaurante' ? Utensils : Store
  const distance =
    b.distanceKm !== undefined
      ? `${formatKm(b.distanceKm)} km de você`
      : b.distanceEstimateKm != null
        ? `≈ ${formatKm(b.distanceEstimateKm)} km do centro (estimativa)`
        : null

  const cover = b.coverUrl ? (
    <Img
      src={b.coverUrl}
      alt=""
      width={640}
      height={360}
      className="h-full w-full rounded-none object-cover"
    />
  ) : (
    <div
      data-testid="cover-fallback"
      aria-hidden="true"
      className="flex h-full w-full items-center justify-center bg-muted text-ink-muted"
    >
      <FallbackIcon className="size-8" />
    </div>
  )

  return (
    <article
      data-layout={layout}
      className={`hover-lift pressable relative overflow-hidden rounded-card border border-line bg-surface shadow-[var(--shadow-card)] ${
        isRow ? 'flex min-h-11 gap-3 p-3' : 'flex flex-col'
      }`}
    >
      <div
        className={`relative shrink-0 overflow-hidden bg-muted ${
          isRow ? 'size-24 rounded-xl' : b.coverUrl ? 'aspect-[16/9] w-full' : 'aspect-[3/1] w-full'
        }`}
      >
        {cover}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {promotion && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warm-soft px-2 py-0.5 text-xs font-semibold text-warm">
              <Flame aria-hidden="true" className="size-3" />
              {promotion.label}
            </span>
          )}
        </div>
      </div>

      <div className={`flex min-w-0 flex-1 flex-col gap-1 ${isRow ? '' : 'p-3'}`}>
        <div className="flex items-start gap-2">
          {!isRow && (
            <div className="-mt-9 shrink-0 rounded-full border-2 border-surface bg-surface">
              {b.logoUrl ? (
                <Img
                  src={b.logoUrl}
                  alt=""
                  width={48}
                  height={48}
                  className="size-12 rounded-full object-cover"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="flex size-12 items-center justify-center rounded-full bg-muted text-brand"
                >
                  <FallbackIcon className="size-5" />
                </div>
              )}
            </div>
          )}
          <div className={`min-w-0 flex-1 ${isRow ? '' : 'pt-1'}`}>
            <h3 className="truncate text-base font-semibold text-ink">
              <Link
                to={businessHref(b)}
                className="after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-card"
              >
                {b.name}
              </Link>
            </h3>
            {categoryLabel && <p className="truncate text-sm text-ink-muted">{categoryLabel}</p>}
          </div>
        </div>

        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
          <li className="inline-flex items-center gap-1">
            <Star aria-hidden="true" className="size-4 text-warm" />
            {b.ratingCount > 0 ? (
              <span>
                <span className="font-semibold text-ink">{b.ratingAvg.toFixed(1).replace('.', ',')}</span> (
                {b.ratingCount})
              </span>
            ) : (
              <span>Novo</span>
            )}
          </li>
          {time && (
            <li className="inline-flex items-center gap-1">
              <Clock aria-hidden="true" className="size-4" />
              {time}
            </li>
          )}
          <li className="inline-flex items-center gap-1">
            <Bike aria-hidden="true" className="size-4" />
            {deliveryText(b)}
          </li>
        </ul>

        {distance && <p className="text-xs text-ink-muted">{distance}</p>}

        <div className="mt-1 flex items-center justify-between gap-2">
          <span
            className={`inline-flex items-center gap-1 text-sm font-semibold ${
              b.isOpen ? 'text-success' : 'text-ink-muted'
            }`}
          >
            {b.isOpen ? (
              <CircleCheck aria-hidden="true" className="size-4" />
            ) : (
              <CircleX aria-hidden="true" className="size-4" />
            )}
            {b.isOpen ? 'Aberto' : 'Fechado'}
          </span>
          <span aria-hidden="true" className="text-sm font-semibold text-brand">
            {b.businessType === 'restaurante' ? 'Ver cardápio' : 'Ver loja'}
          </span>
        </div>
      </div>
    </article>
  )
}
