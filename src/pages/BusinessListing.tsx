import type { LucideIcon } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { BusinessCard } from '../components/cards/BusinessCard.tsx'
import { EmptyState } from '../components/feedback/EmptyState.tsx'
import { ErrorState } from '../components/feedback/ErrorState.tsx'
import { SkeletonCard } from '../components/feedback/Skeleton.tsx'
import { FilterChips } from '../components/nav/FilterChips.tsx'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { useBusinesses, useCategories } from '../features/catalog/hooks.ts'
import type { BusinessType, CategoryKind } from '../features/catalog/schemas.ts'
import { useCurrentCity } from '../features/location/cityStore.ts'

export interface BusinessListingProps {
  type: Exclude<BusinessType, 'restaurante'>
  title: string
  subtitle: string
  icon: LucideIcon
}

/** Listagem de lojas ou serviços com filtro de categoria na URL (?categoria=). */
export function BusinessListing({ type, title, subtitle, icon }: BusinessListingProps) {
  const [params, setParams] = useSearchParams()
  const categorySlug = params.get('categoria') ?? ''
  const { city } = useCurrentCity()
  const categories = useCategories(type as CategoryKind)
  const list = useBusinesses(city?.id, type, categorySlug || undefined)
  const options = [{ value: '', label: 'Todas' }, ...(categories.data ?? []).map((c) => ({ value: c.slug, label: c.label }))]
  const labels = new Map((categories.data ?? []).map((c) => [c.id, c.label]))
  const setCategory = (v: string) => setParams(v ? { categoria: v } : {}, { replace: true })

  return (
    <Page>
      <PageHeader icon={icon} title={title} subtitle={subtitle} />
      {options.length > 1 && <FilterChips label="Categoria" options={options} value={categorySlug} onChange={setCategory} />}
      {list.isLoading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          title="Nada encontrado"
          description="Ainda não há cadastros nesta categoria."
          action={categorySlug ? <button type="button" onClick={() => setCategory('')} className="pressable min-h-11 rounded-full bg-brand px-4 text-sm font-semibold text-surface">Limpar filtros</button> : undefined}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {(list.data ?? []).map((b) => (
            <li key={b.id}>
              <BusinessCard business={b} categoryLabel={b.categoryId ? labels.get(b.categoryId) : undefined} />
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}