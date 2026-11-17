import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Crosshair, LocateFixed, MapPin, Search } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useToast } from '../../components/feedback/toast-context.ts'
import { formatAddress, type AddressParts } from '../../features/address/address.ts'
import { parseCoordinates } from '../../features/address/coords.ts'
import { getBusinessAddress } from '../../features/address/repository.ts'
import { getStoreLocation, setStoreLocation } from '../../features/gestao/repository.ts'
import type { LngLat } from '../../features/rastreamento/geo.ts'
import { geocodeAddress } from '../../features/rastreamento/repository.ts'

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

export const addressPartsForSearch = (a: AddressParts): Record<string, string> =>
  ({ street: a.street, number: a.number, district: a.district, city: a.city, uf: a.uf, cep: a.cep })

type Mode = 'endereco' | 'mapa' | 'coordenada'
const tab = (on: boolean) => `pressable inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full px-3 text-sm font-semibold ${on ? 'bg-brand text-surface' : 'text-ink hover:bg-muted'}`
const btn = 'pressable inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold disabled:opacity-60'

/**
 * Local da loja no mapa: ponto de partida da rota do entregador até a loja, do frete por distância e do rastreamento.
 * Três formas de marcar: pelo endereço digitado, tocando no mapa (ou "estou na loja", pelo GPS) ou colando a coordenada /
 * link do Google Maps. Sempre confirma no mapa antes de salvar.
 */
export function StoreLocationCard({ businessId, suggestion = null, notice = null }: {
  businessId: string
  /** ponto sugerido (ex.: endereço achado só de forma aproximada) para a pessoa conferir e salvar */
  suggestion?: LngLat | null
  /** aviso no topo (ex.: "não achamos o local exato") — abre o editor */
  notice?: string | null
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['gestao', 'location', businessId], queryFn: () => getStoreLocation(businessId) })
  const addrQ = useQuery({ queryKey: ['merchant', 'address', businessId], queryFn: () => getBusinessAddress(businessId) })
  const [draft, setDraft] = useState<LngLat | null>(null)
  const [editing, setEditing] = useState(false)
  const [mode, setMode] = useState<Mode>('endereco')
  const [coordText, setCoordText] = useState('')
  const [info, setInfo] = useState<string | null>(null)
  const saved: LngLat | null = q.data && q.data.lat !== null && q.data.lng !== null ? [q.data.lng, q.data.lat] : null
  const point = draft ?? saved

  useEffect(() => {
    if (!notice && !suggestion) return
    setEditing(true)
    if (suggestion) { setDraft(suggestion); setMode('mapa'); setInfo('Achamos o local de forma aproximada. Arraste o alfinete até a porta da loja e salve.') }
  }, [notice, suggestion?.[0], suggestion?.[1]]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (p: LngLat) => setStoreLocation(businessId, p[1], p[0]),
    onSuccess: () => {
      toast.success('Local da loja salvo no mapa. O entregador já consegue traçar a rota até aqui.')
      setDraft(null); setEditing(false); setInfo(null)
      void qc.invalidateQueries({ queryKey: ['gestao', 'location', businessId] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.'),
  })
  const locate = useMutation({
    mutationFn: gps,
    onSuccess: (p) => { setDraft(p); setEditing(true); setMode('mapa'); setInfo('Confira o alfinete e salve.') },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Localização indisponível.'),
  })
  const search = useMutation({
    mutationFn: async () => {
      const a = addrQ.data
      if (!a || !a.city) throw new Error('Preencha e salve o endereço da loja (CEP, rua, número e bairro) primeiro.')
      return geocodeAddress(formatAddress(a), null, { parts: addressPartsForSearch(a), approx: true })
    },
    onSuccess: (r) => {
      setDraft([r.lng, r.lat])
      setMode('mapa')
      setInfo(r.approx ? 'Achamos só o bairro/cidade. Arraste o alfinete até a porta da loja e salve.' : `Achamos: ${r.label || 'endereço da loja'}. Confira o alfinete e salve.`)
    },
    onError: (e) => setInfo(`${e instanceof Error ? e.message : 'Endereço não encontrado.'} Marque no mapa ou cole a coordenada.`),
  })
  const useCoords = () => {
    const c = parseCoordinates(coordText)
    if (!c) { setInfo('Coordenada inválida. Exemplo: -20.73712, -46.75245 (ou cole o link do Google Maps).'); return }
    setDraft([c.lng, c.lat]); setMode('mapa'); setInfo('Confira o alfinete e salve.')
  }

  if (q.isError || !q.data) return null
  const mapCenter: LngLat | null = point ?? null
  return (
    <section aria-labelledby={`local-loja-${businessId}`} className={`flex flex-col gap-3 rounded-card border bg-surface p-4 ${saved ? 'border-line' : 'border-2 border-orange'}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className={`grid size-10 shrink-0 place-items-center rounded-xl ${saved ? 'bg-muted text-ink' : 'bg-orange text-ink'}`}><MapPin className="size-5" /></span>
        <div className="min-w-0">
          <h2 id={`local-loja-${businessId}`} className="font-semibold text-ink">Local da loja no mapa</h2>
          <p className="text-sm text-ink-muted">
            {saved ? 'Marcado. O entregador traça a rota até aqui e o frete é calculado pelas ruas.'
              : 'Ainda não marcado: o entregador não consegue traçar a rota até a loja. Marque agora.'}
          </p>
          {q.data.address && <p className="text-sm text-ink-muted">Endereço cadastrado: {q.data.address}</p>}
        </div>
      </div>
      {notice && <p role="alert" className="rounded-xl bg-muted p-3 text-sm font-semibold text-ink">{notice}</p>}

      {!editing ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setEditing(true)} className={`${btn} bg-brand text-surface`}>{saved ? 'Ajustar local' : 'Marcar local da loja'}</button>
          <button type="button" onClick={() => locate.mutate()} disabled={locate.isPending} className={`${btn} border border-line text-ink`}>
            <LocateFixed aria-hidden="true" className="size-4" />{locate.isPending ? 'Localizando…' : 'Estou na loja: usar minha localização'}
          </button>
        </div>
      ) : (
        <>
          <div role="tablist" aria-label="Como marcar o local" className="flex gap-1 rounded-full border border-line p-1">
            <button type="button" role="tab" aria-selected={mode === 'endereco'} onClick={() => setMode('endereco')} className={tab(mode === 'endereco')}><Search aria-hidden="true" className="size-4" />Endereço</button>
            <button type="button" role="tab" aria-selected={mode === 'mapa'} onClick={() => setMode('mapa')} className={tab(mode === 'mapa')}><MapPin aria-hidden="true" className="size-4" />Mapa</button>
            <button type="button" role="tab" aria-selected={mode === 'coordenada'} onClick={() => setMode('coordenada')} className={tab(mode === 'coordenada')}><Crosshair aria-hidden="true" className="size-4" />Coordenada</button>
          </div>

          {mode === 'endereco' && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-ink-muted">Buscamos o endereço cadastrado da loja{addrQ.data?.city ? `: ${formatAddress(addrQ.data)}` : ''}. Depois você confere no mapa.</p>
              <button type="button" onClick={() => search.mutate()} disabled={search.isPending} className={`${btn} w-fit bg-brand text-surface`}>
                <Search aria-hidden="true" className="size-4" />{search.isPending ? 'Buscando…' : 'Buscar pelo endereço'}
              </button>
            </div>
          )}
          {mode === 'coordenada' && (
            <div className="flex flex-col gap-2">
              <label htmlFor={`coord-${businessId}`} className="text-sm font-medium text-ink">Coordenada ou link do Google Maps</label>
              <input id={`coord-${businessId}`} value={coordText} onChange={(e) => setCoordText(e.target.value)} inputMode="text"
                placeholder="-20.73712, -46.75245" className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink" />
              <p className="text-xs text-ink-muted">No Google Maps: segure o dedo em cima da loja, copie os números que aparecem e cole aqui.</p>
              <button type="button" onClick={useCoords} className={`${btn} w-fit bg-brand text-surface`}><Crosshair aria-hidden="true" className="size-4" />Usar esta coordenada</button>
            </div>
          )}
          {info && <p role="status" className="text-sm font-semibold text-ink">{info}</p>}
          {mode === 'mapa' && (
            <>
              <p className="text-sm text-ink">Toque no mapa ou arraste o alfinete laranja até a porta da loja.</p>
              <button type="button" onClick={() => locate.mutate()} disabled={locate.isPending} className={`${btn} w-fit border border-line text-ink`}>
                <LocateFixed aria-hidden="true" className="size-4" />{locate.isPending ? 'Localizando…' : 'Estou na loja: usar minha localização'}
              </button>
              <Suspense fallback={<div className="h-72 animate-pulse rounded-card bg-muted sm:h-80" aria-hidden="true" />}>
                <LocationPickerMap value={point} onChange={setDraft} center={mapCenter} label="Mapa para marcar o local da loja" />
              </Suspense>
            </>
          )}
          {point && <p className="text-xs text-ink-muted">Ponto: {point[1].toFixed(5)}, {point[0].toFixed(5)}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!draft || save.isPending} onClick={() => draft && save.mutate(draft)} className={`${btn} bg-brand text-surface`}>
              {save.isPending ? 'Salvando…' : 'Salvar local'}
            </button>
            <button type="button" onClick={() => { setDraft(null); setEditing(false); setInfo(null) }} className={`${btn} border border-line text-ink`}>Cancelar</button>
          </div>
        </>
      )}
    </section>
  )
}
