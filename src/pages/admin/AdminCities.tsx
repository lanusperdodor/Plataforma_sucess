import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPinned, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { listCities, saveCity, type AdminCity, type CityInput } from '../../features/admin/repository.ts'
import { AdminHeader, errorMessage, inputClass, Panel, primaryButton, secondaryButton } from './ui.tsx'

/** Converte "-20,74" ou "-20.74" em número; vazio = null; inválido = NaN. */
export function parseCoordinate(raw: string): number | null {
  const t = raw.trim().replace(',', '.')
  if (!t) return null
  return /^-?\d{1,3}(\.\d+)?$/.test(t) ? Number(t) : Number.NaN
}

function CityForm({ city, onDone }: { city: AdminCity | null; onDone: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState(city?.name ?? '')
  const [state, setState] = useState(city?.state ?? 'MG')
  const [lat, setLat] = useState(city?.centerLat?.toString() ?? '')
  const [lng, setLng] = useState(city?.centerLng?.toString() ?? '')
  const [active, setActive] = useState(city?.isActive ?? false)
  const [error, setError] = useState<string>()
  const m = useMutation({
    mutationFn: (input: CityInput) => saveCity(input),
    onSuccess: () => {
      toast.success(city ? 'Cidade atualizada.' : 'Cidade cadastrada.')
      void qc.invalidateQueries({ queryKey: ['admin'] })
      void qc.invalidateQueries({ queryKey: ['catalog'] })
      onDone()
    },
    onError: (e) => setError(errorMessage(e)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(undefined)
    const centerLat = parseCoordinate(lat)
    const centerLng = parseCoordinate(lng)
    if (Number.isNaN(centerLat) || Number.isNaN(centerLng)) return setError('Coordenadas inválidas. Use o formato -20.7389.')
    if ((centerLat === null) !== (centerLng === null)) return setError('Informe latitude e longitude juntas, ou deixe as duas vazias.')
    m.mutate({ id: city?.id ?? null, name, state, centerLat, centerLng, isActive: active })
  }
  return (
    <Panel>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-6">
        <div className="sm:col-span-4">
          <label htmlFor="city-name" className="mb-1 block text-sm font-medium text-ink">Cidade</label>
          <input id="city-name" required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="city-uf" className="mb-1 block text-sm font-medium text-ink">UF</label>
          <input id="city-uf" required maxLength={2} value={state} onChange={(e) => setState(e.target.value.toUpperCase())} className={inputClass} />
        </div>
        <div className="sm:col-span-3">
          <label htmlFor="city-lat" className="mb-1 block text-sm font-medium text-ink">Latitude do centro (opcional)</label>
          <input id="city-lat" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} className={inputClass} />
        </div>
        <div className="sm:col-span-3">
          <label htmlFor="city-lng" className="mb-1 block text-sm font-medium text-ink">Longitude do centro (opcional)</label>
          <input id="city-lng" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} className={inputClass} />
        </div>
        <p className="text-xs text-ink-muted sm:col-span-6">
          Use coordenadas oficiais (ex.: IBGE). Elas servem à descoberta regional; a área de entrega é definida por cada estabelecimento.
        </p>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink sm:col-span-6">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-5" />
          Cidade ativa (visível para clientes)
        </label>
        {error && <p role="alert" className="text-sm text-danger sm:col-span-6">{error}</p>}
        <div className="flex gap-2 sm:col-span-6">
          <button type="submit" disabled={m.isPending} className={primaryButton}>{m.isPending ? 'Salvando…' : 'Salvar'}</button>
          <button type="button" onClick={onDone} className={secondaryButton}>Cancelar</button>
        </div>
      </form>
    </Panel>
  )
}

export function AdminCities() {
  const q = useQuery({ queryKey: ['admin', 'cities'], queryFn: listCities })
  const [editing, setEditing] = useState<AdminCity | 'new' | null>(null)
  return (
    <>
      <AdminHeader
        title="Cidades"
        subtitle="Municípios atendidos. Só cidades ativas aparecem para os clientes."
        actions={editing ? undefined : <button type="button" onClick={() => setEditing('new')} className={primaryButton}><Plus aria-hidden="true" className="size-4" />Nova cidade</button>}
      />
      {editing && <div className="mb-4"><CityForm city={editing === 'new' ? null : editing} onDone={() => setEditing(null)} /></div>}
      {q.isLoading ? (
        <p role="status" className="text-sm text-ink-muted">Carregando…</p>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState icon={MapPinned} title="Nenhuma cidade cadastrada" />
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-line text-ink-muted">
              <tr>
                <th scope="col" className="p-3 font-semibold">Cidade</th>
                <th scope="col" className="p-3 font-semibold">Situação</th>
                <th scope="col" className="p-3 font-semibold">Centro</th>
                <th scope="col" className="p-3 font-semibold">Estabelecimentos ativos</th>
                <th scope="col" className="p-3"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <td className="p-3 font-semibold text-ink">{c.name}, {c.state}</td>
                  <td className="p-3">{c.isActive ? <span className="text-success">Ativa</span> : <span className="text-ink-muted">Inativa</span>}</td>
                  <td className="p-3 text-ink-muted">{c.centerLat != null ? `${c.centerLat}, ${c.centerLng}` : 'Não definido'}</td>
                  <td className="p-3 tabular-nums">{c.businessesActive}</td>
                  <td className="p-3 text-right">
                    <button type="button" onClick={() => setEditing(c)} className={secondaryButton}>Editar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
