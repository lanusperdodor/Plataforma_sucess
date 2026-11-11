import { SlidersHorizontal, UtensilsCrossed } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BusinessCard } from '../components/cards/BusinessCard.tsx'
import { EmptyState } from '../components/feedback/EmptyState.tsx'
import { ErrorState } from '../components/feedback/ErrorState.tsx'
import { SkeletonCard } from '../components/feedback/Skeleton.tsx'
import { FilterChips } from '../components/nav/FilterChips.tsx'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { parseRestaurantFilters, serializeRestaurantFilters, toQueryFilters, type RestaurantFilters } from '../features/catalog/filters.ts'
import { useCategories, useRestaurants } from '../features/catalog/hooks.ts'
import { useCurrentCity } from '../features/location/cityStore.ts'

const MODES = [
  { value: '', label: 'Entrega e retirada' },
  { value: 'delivery', label: 'Entrega' },
  { value: 'pickup', label: 'Retirada' },
] as const
const SORTS = [
  { value: 'popularity', label: 'Mais pedidos' },
  { value: 'proximity', label: 'Mais perto (estimativa)' },
  { value: 'delivery_time', label: 'Mais rápidos' },
] as const

/** Restaurantes com filtros e ordenação na URL (voltar da loja restaura a escolha). */
export function RestaurantsPage() {
  const [params, setParams] = useSearchParams()
  const filters = parseRestaurantFilters(params)
  const { city } = useCurrentCity()
  const categories = useCategories('restaurante')
  const list = useRestaurants(city?.id, toQueryFilters(filters))
  const labels = new Map((categories.data ?? []).map((c) => [c.id, c.label]))
  const update = (patch: Partial<RestaurantFilters>) => {
    const next = { ...filters, ...patch }
    for (const k of Object.keys(patch) as (keyof RestaurantFilters)[]) if (patch[k] === undefined) delete next[k]
    setParams(serializeRestaurantFilters(next), { replace: true })
  }
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const hasFilters = params.toString() !== ''
  const extra = (filters.fulfillment ? 1 : 0) + (filters.sort !== 'popularity' ? 1 : 0)
  const [showMore, setShowMore] = useState(extra > 0)

  return (
    <Page>
      <PageHeader icon={UtensilsCrossed} title="Restaurantes" subtitle="Peça para entregar ou retire no balcão." />
      <div className="sticky top-[var(--header-h-compact)] z-20 -mx-4 flex flex-col gap-2 border-b border-line bg-muted/95 px-4 py-2 backdrop-blur md:mx-0 md:rounded-card md:border md:px-3">
        <FilterChips
          label="Categoria"
          options={[{ value: '', label: 'Todas' }, ...(categories.data ?? []).map((c) => ({ value: c.slug, label: c.label }))]}
          value={filters.categorySlug ?? ''}
          onChange={(v) => update({ categorySlug: v || undefined })}
        />
        <button
          type="button"
          aria-expanded={showMore}
          onClick={() => setShowMore((v) => !v)}
          className="pressable inline-flex min-h-11 w-fit items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink"
        >
          <SlidersHorizontal aria-hidden="true" className="size-4" />
          Entrega e ordem
          {extra > 0 && <span className="grid size-5 place-items-center rounded-full bg-orange text-xs text-ink">{extra}</span>}
        </button>
        {showMore && (
          <div className="flex flex-col gap-2 lg:flex-row">
            <FilterChips label="Modo" options={MODES} value={filters.fulfillment ?? ''} onChange={(v) => update({ fulfillment: v || undefined })} />
            <FilterChips label="Ordenar por" options={SORTS} value={filters.sort} onChange={(v) => update({ sort: v })} />
          </div>
        )}
      </div>
      {list.isLoading || !city ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nenhum restaurante com esses filtros"
          description="Tente outra categoria ou modo de entrega."
          action={hasFilters ? <button type="button" onClick={() => setParams({}, { replace: true })} className="pressable min-h-11 rounded-full bg-brand px-4 text-sm font-semibold text-surface">Limpar filtros</button> : undefined}
        />
      ) : (
        <>
          <p className="text-sm text-ink-muted" aria-live="polite">{items.length} {items.length === 1 ? 'restaurante' : 'restaurantes'}</p>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {items.map((b) => (
              <li key={b.id}>
                <BusinessCard business={b} categoryLabel={b.categoryId ? labels.get(b.categoryId) : undefined} />
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <button type="button" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className="pressable mx-auto min-h-11 rounded-full border border-line bg-surface px-6 text-sm font-semibold text-ink">
              {list.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
            </button>
          )}
        </>
      )}
    </Page>
  )
}