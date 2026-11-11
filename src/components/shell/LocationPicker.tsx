import { MapPin } from 'lucide-react'
import { useState } from 'react'
import { BRAND } from '../../config/brand.ts'
import { useCurrentCity } from '../../features/location/cityStore.ts'
import { Dialog } from '../overlays/Dialog.tsx'
import { Sheet } from '../overlays/Sheet.tsx'
import { useBreakpoint } from './useBreakpoint.ts'

export function LocationPicker() {
  const { city, cities, setCity, isLoading, isError, refetch } = useCurrentCity()
  const layout = useBreakpoint()
  const [open, setOpen] = useState(false)

  const label = city
    ? `${city.name}, ${city.state}`
    : `${BRAND.initialRegion.city}, ${BRAND.initialRegion.state}`
  const close = () => setOpen(false)

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
        <div role="radiogroup" aria-label="Cidades" className="flex flex-col gap-1">
          {cities.map((c) => {
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
                className={`pressable flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-3 text-left text-sm ${selected ? 'border-brand font-semibold text-brand' : 'border-line text-ink'}`}
              >
                <span>
                  {c.name}, {c.state}
                </span>
              </button>
            )
          })}
        </div>
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
