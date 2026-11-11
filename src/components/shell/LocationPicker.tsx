import { useQuery } from '@tanstack/react-query'
import { Check, MapPin, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { BRAND } from '../../config/brand.ts'
import { searchCities } from '../../features/catalog/repository.ts'
import { useCurrentCity } from '../../features/location/cityStore.ts'
import { Dialog } from '../overlays/Dialog.tsx'
import { Sheet } from '../overlays/Sheet.tsx'
import { useBreakpoint } from './useBreakpoint.ts'

/** Busca sem acento e sem diferenciar maiúsculas ("sao jose" encontra "São José"). */
export function normalizeCity(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

/** Espera o usuário parar de digitar antes de consultar o banco. */
function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = globalThis.setTimeout(() => setV(value), ms)
    return () => globalThis.clearTimeout(t)
  }, [value, ms])
  return v
}

const UFS = [{ value: '', label: 'Todas' }, { value: 'MG', label: 'MG' }, { value: 'SP', label: 'SP' }] as const

export function LocationPicker() {
  const { city, cities, setCity, isLoading, isError, refetch } = useCurrentCity()
  const layout = useBreakpoint()
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [uf, setUf] = useState('')
  const q = normalizeCity(term)
  const debounced = useDebounced(q)
  // busca no banco (escala para milhares de cidades); a lista já carregada responde na hora e cobre banco sem a função
  const remote = useQuery({
    queryKey: ['catalog', 'city-search', debounced, uf],
    queryFn: () => searchCities(debounced, uf || null, 30),
    enabled: open && debounced.length >= 2,
    staleTime: 300_000,
  })
  const local = cities.filter((c) => (!uf || c.state === uf) && (!q || normalizeCity(`${c.name} ${c.state}`).includes(q)))
  const useRemote = q.length >= 2 && debounced === q && Array.isArray(remote.data)
  const shown = useRemote ? remote.data! : local
  const states = [...new Set(shown.map((c) => c.state))].sort()

  const label = city
    ? `${city.name}, ${city.state}`
    : `${BRAND.initialRegion.city}, ${BRAND.initialRegion.state}`
  const close = () => {
    setOpen(false)
    setTerm('')
    setUf('')
  }

  const body = (
    <div className="flex flex-col gap-1 p-4">
      {isLoading ? (
        <p role="status" className="py-3 text-sm text-ink-muted">
          Carregando cidades…
        </p>
      ) : isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 py-3 text-sm">
          <p>Não foi possível carregar as cidades.</p>
          <button
            type="button"
            onClick={refetch}
            className="pressable min-h-11 rounded-full border border-line px-4 font-semibold text-brand"
          >
            Tentar novamente
          </button>
        </div>
      ) : cities.length === 0 ? (
        <p className="py-3 text-sm text-ink-muted">Nenhuma cidade disponível no momento.</p>
      ) : (
        <>
          <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-1 flex flex-col gap-2 bg-surface px-4 pb-3 pt-4">
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
              <input
                type="search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Buscar cidade (ex.: sao sebastiao)"
                aria-label="Buscar cidade"
                className="no-native-clear min-h-11 w-full rounded-full border border-line bg-muted pl-9 pr-10 text-sm text-ink"
              />
              {term && (
                <button type="button" onClick={() => setTerm('')} aria-label="Limpar busca" className="pressable absolute right-1 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted">
                  <X aria-hidden="true" className="size-4" />
                </button>
              )}
            </div>
            <div role="radiogroup" aria-label="Estado" className="flex gap-1">
              {UFS.map((u) => (
                <button key={u.value} type="button" role="radio" aria-checked={uf === u.value} onClick={() => setUf(u.value)}
                  className={`pressable min-h-9 rounded-full px-3 text-xs font-semibold ${uf === u.value ? 'bg-brand text-surface' : 'border border-line text-ink'}`}>
                  {u.label}
                </button>
              ))}
              {q.length >= 2 && remote.isFetching && <span role="status" className="ml-auto self-center text-xs text-ink-muted">Buscando…</span>}
            </div>
          </div>
          {shown.length === 0 ? (
            <p role="status" className="py-3 text-sm text-ink-muted">Nenhuma cidade encontrada{term ? ` para “${term}”` : ''}. Confira a grafia ou limpe a busca.</p>
          ) : (
            <div role="radiogroup" aria-label="Cidades" className="flex flex-col gap-1">
              {states.map((uf) => (
                <div key={uf} className="flex flex-col gap-1">
                  {states.length > 1 && <p className="px-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{uf === 'MG' ? 'Minas Gerais' : uf === 'SP' ? 'São Paulo' : uf}</p>}
                  {shown.filter((c) => c.state === uf).map((c) => {
                    const selected = c.id === city?.id
                    return (
                      <button
                        key={c.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => {
                          setCity(c.id)
                          close()
                        }}
                        className={`pressable flex min-h-12 w-full shrink-0 items-center justify-between gap-2 rounded-xl px-3 text-left text-sm transition-colors ${selected ? 'bg-muted font-semibold text-ink' : 'text-ink hover:bg-muted'}`}
                      >
                        <span className="flex items-center gap-2">
                          <MapPin aria-hidden="true" className={`size-4 shrink-0 ${selected ? 'text-accent' : 'text-ink-muted'}`} />
                          {c.name}, {c.state}
                        </span>
                        {selected && <Check aria-hidden="true" className="size-4 shrink-0 text-accent" />}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )

  const title = 'Escolha sua cidade'
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="pressable inline-flex min-h-11 max-w-full min-w-0 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-ink"
      >
        <MapPin aria-hidden="true" className="size-4 shrink-0 text-brand" />
        <span className="min-w-0 truncate">{label}</span>
      </button>
      {layout === 'mobile' ? (
        <Sheet open={open} onClose={close} title={title} className="scroll-soft">
          {body}
        </Sheet>
      ) : (
        <Dialog open={open} onClose={close} title={title} className="scroll-soft">
          {body}
        </Dialog>
      )}
    </>
  )
}
