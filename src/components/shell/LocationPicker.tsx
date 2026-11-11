import { MapPin, Search } from 'lucide-react'
import { useState } from 'react'
import { BRAND } from '../../config/brand.ts'
import { useCurrentCity } from '../../features/location/cityStore.ts'
import { Dialog } from '../overlays/Dialog.tsx'
import { Sheet } from '../overlays/Sheet.tsx'
import { useBreakpoint } from './useBreakpoint.ts'

/** Busca sem acento e sem diferenciar maiúsculas ("sao jose" encontra "São José"). */
export function normalizeCity(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

export function LocationPicker() {
  const { city, cities, setCity, isLoading, isError, refetch } = useCurrentCity()
  const layout = useBreakpoint()
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const q = normalizeCity(term)
  const shown = q ? cities.filter((c) => normalizeCity(`${c.name} ${c.state}`).includes(q)) : cities
  const states = [...new Set(shown.map((c) => c.state))].sort()

  const label = city
    ? `${city.name}, ${city.state}`
    : `${BRAND.initialRegion.city}, ${BRAND.initialRegion.state}`
  const close = () => {
    setOpen(false)
    setTerm('')
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
          {cities.length > 8 && (
            <div className="relative mb-2">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
              <input
                type="search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Buscar cidade"
                aria-label="Buscar cidade"
                className="min-h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink"
              />
            </div>
          )}
          {shown.length === 0 ? (
            <p role="status" className="py-3 text-sm text-ink-muted">Nenhuma cidade encontrada.</p>
          ) : (
            <div role="radiogroup" aria-label="Cidades" className="flex max-h-[60dvh] flex-col gap-1 overflow-y-auto">
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
                        className={`pressable flex min-h-11 w-full shrink-0 items-center justify-between gap-2 rounded-xl border px-3 text-left text-sm ${selected ? 'border-brand font-semibold text-brand' : 'border-line text-ink'}`}
                      >
                        <span>
                          {c.name}, {c.state}
                        </span>
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
        <Sheet open={open} onClose={close} title={title}>
          {body}
        </Sheet>
      ) : (
        <Dialog open={open} onClose={close} title={title}>
          {body}
        </Dialog>
      )}
    </>
  )
}
