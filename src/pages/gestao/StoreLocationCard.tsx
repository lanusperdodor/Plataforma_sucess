import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LocateFixed, MapPin } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useToast } from '../../components/feedback/toast-context.ts'
import { getStoreLocation, setStoreLocation } from '../../features/gestao/repository.ts'
import type { LngLat } from '../../features/rastreamento/geo.ts'

const LocationPickerMap = lazy(() => import('../../components/map/LocationPickerMap.tsx'))

function gps(): Promise<LngLat> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(new Error('Este aparelho não informa a localização.')); return }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([Number(p.coords.longitude.toFixed(6)), Number(p.coords.latitude.toFixed(6))]),
      () => reject(new Error('Não foi possível pegar sua localização. Permita o acesso ou marque no mapa.')),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    )
  })
}

/**
 * Local da loja no mapa: usado no frete por distância (rota por ruas até o cliente) e no mapa do rastreamento.
 * Sem ele, o pedido usa o frete padrão.
 */
export function StoreLocationCard({ businessId }: { businessId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['gestao', 'location', businessId], queryFn: () => getStoreLocation(businessId) })
  const [draft, setDraft] = useState<LngLat | null>(null)
  const [editing, setEditing] = useState(false)
  const saved: LngLat | null = q.data && q.data.lat !== null && q.data.lng !== null ? [q.data.lng, q.data.lat] : null
  const point = draft ?? saved

  const save = useMutation({
    mutationFn: (p: LngLat) => setStoreLocation(businessId, p[1], p[0]),
    onSuccess: () => {
      toast.success('Local da loja salvo no mapa.')
      setDraft(null); setEditing(false)
      void qc.invalidateQueries({ queryKey: ['gestao', 'location', businessId] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.'),
  })
  const locate = useMutation({
    mutationFn: gps,
    onSuccess: (p) => { setDraft(p); setEditing(true) },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Localização indisponível.'),
  })

  if (q.isError || !q.data) return null
  return (
    <section aria-labelledby="local-loja" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-ink"><MapPin className="size-5" /></span>
        <div className="min-w-0">
          <h2 id="local-loja" className="font-semibold text-ink">Local da loja no mapa</h2>
          <p className="text-sm text-ink-muted">
            {saved ? 'Marcado. O frete é calculado pela rota por ruas da loja até o cliente.'
              : 'Ainda não marcado. Sem ele, o frete por distância não é calculado e o pedido usa o frete padrão.'}
          </p>
          {q.data.address && <p className="text-sm text-ink-muted">Endereço cadastrado: {q.data.address}</p>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => locate.mutate()} disabled={locate.isPending}
          className="pressable inline-flex min-h-11 items-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-surface disabled:opacity-60">
          <LocateFixed aria-hidden="true" className="size-4" />{locate.isPending ? 'Localizando…' : 'Estou na loja: usar minha localização'}
        </button>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className="pressable inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-ink">
            {saved ? 'Ajustar no mapa' : 'Marcar no mapa'}
          </button>
        )}
      </div>

      {editing && (
        <>
          <p className="text-sm text-ink">Toque no mapa ou arraste o alfinete laranja até a porta da loja.</p>
          <Suspense fallback={<div className="h-72 animate-pulse rounded-card bg-muted sm:h-80" aria-hidden="true" />}>
            <LocationPickerMap value={point} onChange={setDraft} label="Mapa para marcar o local da loja" />
          </Suspense>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!point || save.isPending} onClick={() => point && save.mutate(point)}
              className="pressable inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-sm font-semibold text-surface disabled:opacity-60">
              {save.isPending ? 'Salvando…' : 'Salvar local'}
            </button>
            <button type="button" onClick={() => { setDraft(null); setEditing(false) }} className="pressable inline-flex min-h-11 items-center rounded-full border border-line px-5 text-sm font-semibold text-ink">
              Cancelar
            </button>
          </div>
        </>
      )}
    </section>
  )
}
