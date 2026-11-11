import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { z } from 'zod'
import { BRAND } from '../../config/brand'
import { readStorage, removeStorage, writeStorage } from '../../lib/storage'
import { useCities } from '../catalog/hooks'
import type { City } from '../catalog/schemas'

export const CITY_KEY = 'city:v1'

const citySchema = z.string().min(1)
const listeners = new Set<() => void>()

/** Id da cidade escolhida ou null (vazio/inválido). */
export function getStoredCityId(): string | null {
  return readStorage(CITY_KEY, citySchema)
}

export function setStoredCityId(id: string | null): void {
  if (id) writeStorage(CITY_KEY, id)
  else removeStorage(CITY_KEY)
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === CITY_KEY) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** [id | null, setter]. Strings são comparáveis por valor, então o snapshot é estável. */
export function useCity(): readonly [string | null, (id: string | null) => void] {
  const id = useSyncExternalStore(subscribe, getStoredCityId, () => null)
  return useMemo(() => [id, setStoredCityId] as const, [id])
}

export interface CurrentCity {
  city: City | null
  cities: City[]
  setCity: (id: string) => void
  isLoading: boolean
  isError: boolean
  error: unknown
  refetch: () => void
}

/**
 * Cidade atual: a escolhida (se ainda existir), senão a região inicial (Itaú de Minas), senão a primeira ativa.
 * Sincronizar com `profiles.preferred_city_id` fica para quando houver repositório de perfil.
 */
export function useCurrentCity(): CurrentCity {
  const [storedId] = useCity()
  const query = useCities()
  const cities = useMemo(() => query.data ?? [], [query.data])
  const city = useMemo(
    () =>
      cities.find((c) => c.id === storedId) ??
      cities.find((c) => c.name === BRAND.initialRegion.city && c.state === BRAND.initialRegion.state) ??
      cities[0] ??
      null,
    [cities, storedId],
  )
  const setCity = useCallback((id: string) => setStoredCityId(id), [])
  const refetch = useCallback(() => void query.refetch(), [query])
  return { city, cities, setCity, isLoading: query.isLoading, isError: query.isError, error: query.error, refetch }
}
