import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { Page } from '../../lib/pagination'
import { qk } from './keys'
import {
  getBusinessHours,
  listCategories,
  listCities,
  listBusinesses,
  listFeatured,
  listRestaurants,
  type RestaurantQueryFilters,
} from './repository'
import type { BusinessSummary, CategoryKind } from './schemas'

/** Catálogo muda pouco: 5 minutos sem refetch. */
export const CATALOG_STALE_TIME = 5 * 60_000

export function useCities() {
  return useQuery({ queryKey: qk.cities(), queryFn: listCities, staleTime: CATALOG_STALE_TIME })
}

export function useCategories(kind?: CategoryKind) {
  return useQuery({
    queryKey: qk.categories(kind),
    queryFn: () => listCategories(kind),
    staleTime: CATALOG_STALE_TIME,
  })
}

/** Lista paginada (12 por página); `fetchNextPage` segue `Page.nextPage`. */
export function useRestaurants(cityId: string | undefined, filters: RestaurantQueryFilters = {}) {
  return useInfiniteQuery<Page<BusinessSummary>, Error, { pages: Page<BusinessSummary>[] }, readonly unknown[], number>({
    queryKey: qk.restaurants(cityId ?? '', { ...filters }),
    queryFn: ({ pageParam }) => listRestaurants(cityId as string, filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextPage ?? undefined,
    enabled: !!cityId,
    staleTime: CATALOG_STALE_TIME,
  })
}

export function useFeatured(cityId: string | undefined) {
  return useQuery({
    queryKey: qk.featured(cityId ?? ''),
    queryFn: () => listFeatured(cityId as string),
    enabled: !!cityId,
    staleTime: CATALOG_STALE_TIME,
  })
}

export function useBusinessHours(businessId: string | undefined) {
  return useQuery({
    queryKey: qk.businessHours(businessId ?? ''),
    queryFn: () => getBusinessHours(businessId as string),
    enabled: !!businessId,
    staleTime: CATALOG_STALE_TIME,
  })
}

export function useBusinesses(cityId: string | undefined, type: BusinessSummary['businessType'], categorySlug?: string) {
  return useQuery({
    queryKey: ['catalog', 'businesses', cityId ?? '', type, categorySlug ?? ''] as const,
    queryFn: () => listBusinesses(cityId!, type, categorySlug),
    enabled: !!cityId,
    staleTime: CATALOG_STALE_TIME,
  })
}