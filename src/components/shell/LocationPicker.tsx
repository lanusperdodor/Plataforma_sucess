import { MapPin, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BRAND } from '../../config/brand.ts'
import { useCurrentCity } from '../../features/location/cityStore.ts'
import { DISTANCE_BANDS, filterCities, statesOf } from '../../features/location/filterCities.ts'
import { Dialog } from '../overlays/Dialog.tsx'
import { Sheet } from '../overlays/Sheet.tsx'
import { useBreakpoint } from './useBreakpoint.ts'

/** Busca sem acento e sem diferenciar maiúsculas. */
export function normalizeCity(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

export function LocationPicker() {
  const { city, cities, setCity, isLoading, isError, refetch } = useCurrentCity()
  const layout = useBreakpoint()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [state, setState] = useState('')
  const [maxKm, setMaxKm] = useState<number | null>(null)
  const allStates = useMemo(() => statesOf(cities), [cities])
  const hasDistances = cities.some((c) => c.distanceFromHqKm != null)
  const visible = useMemo(
    () => filterCities(cities, { query, state, maxDistanceKm: maxKm }),
    [cities, query, state, maxKm],
  )
  const visibleStates = useMemo(() => statesOf(visible), [visible])
  const chip = (active: boolean) =>
    `pressable inline-flex min-h-9 items-center rounded-full border px-3 text-xs ${active ? 'border-brand font-semibold text-brand' : 'border-line text-ink'}`

  const label = city
    ? `${city.name}, ${city.state}`
    : `${BRAND.initialRegion.city}, ${BRAND.initialRegion.state}`

  const close = () => {
    setOpen(false)
    setQuery('')
    setState('')
    setMaxKm(null)
  }

  const body = (
    <div className="flex flex-col gap-1 p-4">
      {isLoading ? (
        <p role="status" className="py-3 text-sm text-ink-muted">Carregando cidades…</p>
      ) : isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 py-3 text-sm">
          <p>Não foi possível carregar as cidades.</p>
          <button type="button" onClick={refetch} className="pressable min-h-11 rounded-full border border-line px-4 font-semibold text-brand">
            Tentar novamente
          </button>
        </div>
      ) : cities.length === 0 ? (
        <p className="py-3 text-sm text-ink-muted">Nenhuma cidade disponível no momento.</p>
      ) : (
        <>
          <div className="mb-2 flex flex-col gap-2">
            <label className="relative block">
              <span className="sr-only">Buscar cidade</span>
              <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar cidade"
                className="min-h-11 w-full rounded-xl border border-line bg-surface pr-3 pl-9 text-sm text-ink"
              />
            </label>
            {allStates.length > 1 && (
              <div role="group" aria-label="Filtrar por UF" className="flex flex-wrap gap-1.5">
                {['', ...allStates].map((uf) => (
                  <button key={uf || 'all'} type="button" aria-pressed={state === uf} onClick={() => setState(uf)} className={chip(state === uf)}>
                    {uf || 'Todas as UFs'}
                  </button>
                ))}
              </div>
            )}
            {hasDistances && (
              <div role="group" aria-label={`Região: distância de ${BRAND.initialRegion.city}`} className="flex flex-wrap gap-1.5">
                {[null, ...DISTANCE_BANDS].map((km) => (
                  <button key={km ?? 'all'} type="button" aria-pressed={maxKm === km} onClick={() => setMaxKm(km)} className={chip(maxKm === km)}>
                    {km == null ? 'Toda a região' : `Até ${km} km`}
                  </button>
                ))}
              </div>
            )}
          </div>
          {visible.length === 0 ? (
            <p role="status" className="py-3 text-sm text-ink-muted">Nenhuma cidade encontrada com esses filtros.</p>
          ) : (
            <div role="radiogroup" aria-label="Cidades" className="flex max-h-[60dvh] flex-col gap-1 overflow-y-auto">
              {visibleStates.map((uf) => (
                <div key={uf} className="flex flex-col gap-1">
                  {visibleStates.length > 1 && (
                    <p className="px-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">