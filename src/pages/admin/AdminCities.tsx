import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, MapPinned, RefreshCw } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import {
  CITY_STATUS_LABEL,
  cityStatuses,
  getCityCoverage,
  linkCityIbge,
  listCities,
  setCityStatus,
  syncEligibleCities,
  type AdminCity,
  type AdminCityFilters,
  type CityCoverage,
  type CityStatus,
} from '../../features/admin/repository.ts'
import { DISTANCE_BANDS } from '../../features/location/filterCities.ts'
import { AdminHeader, dangerButton, errorMessage, inputClass, Panel, primaryButton, secondaryButton } from './ui.tsx'

/** Transições oferecidas para cada situação (o servidor valida de novo). */
export function cityActions(status: CityStatus): { to: CityStatus; label: string }[] {
  switch (status) {
    case 'planned':
      return [{ to: 'active', label: 'Ativar' }]
    case 'active':
      return [{ to: 'suspended', label: 'Suspender' }]
    case 'suspended':
      return [
        { to: 'active', label: 'Reativar' },
        { to: 'planned', label: 'Voltar a planejada' },
      ]
  }
}

export function formatKm(km: number | null): string {
  return km == null ? '—' : `${km.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`
}

/** Código IBGE de município: 7 dígitos. */
export function parseIbgeCode(raw: string): number | null {
  const t = raw.trim()
  return /^\d{7}$/.test(t) ? Number(t) : null
}

const statusTone: Record<CityStatus, string> = {
  active: 'text-success',
  planned: 'text-ink-muted',
  suspended: 'text-danger',
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['admin'] })
    void qc.invalidateQueries({ queryKey: ['catalog'] })
  }
}

function LinkIbgeForm({ city }: { city: CityCoverage['withoutIbge'][number] }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string>()
  const m = useMutation({
    mutationFn: (ibge: number) => linkCityIbge(city.id, ibge),
    onSuccess: () => {
      toast.success(`${city.name} vinculada ao IBGE.`)
      invalidate()
    },
    onError: (e) => setError(errorMessage(e)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(undefined)
    const ibge = parseIbgeCode(code)
    if (ibge == null) return setError('Informe o código IBGE de 7 dígitos.')
    m.mutate(ibge)
  }
  const id = `ibge-${city.id}`
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="min-w-0 flex-1 text-sm text-ink">
        {city.name}, {city.state} <span className="text-ink-muted">({CITY_STATUS_LABEL[city.status]})</span>
      </label>
      <input id={id} inputMode="numeric" maxLength={7} placeholder="Código IBGE" value={code} onChange={(e) => setCode(e.target.value)} className={`${inputClass} w-36`} />
      <button type="submit" disabled={m.isPending} className={secondaryButton}>Vincular</button>
      {error && <p role="alert" className="w-full text-sm text-danger">{error}</p>}
    </form>
  )
}

function CoveragePanel() {
  const toast = useToast()
  const invalidate = useInvalidate()
  const q = useQuery({ queryKey: ['admin', 'cities', 'coverage'], queryFn: getCityCoverage })
  const sync = useMutation({
    mutationFn: syncEligibleCities,
    onSuccess: (n) => {
      toast.success(n === 0 ? 'Nenhuma cidade faltando.' : `${n} cidade(s) cadastrada(s) como planejadas.`)
      invalidate()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (q.isLoading) return <p role="status" className="text-sm text-ink-muted">Carregando cobertura…</p>
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const c = q.data!
  return (
    <Panel className="mb-4 flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-ink-muted">Sede</dt>
          <dd className="font-semibold text-ink">{c.hq ? `${c.hq.name}, ${c.hq.state}` : '—'}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Área de atendimento</dt>
          <dd className="font-semibold text-ink">{formatKm(c.serviceRadiusKm)} · {c.eligibleStates.join(' e ')}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Descoberta regional</dt>
          <dd className="font-semibold text-ink">{formatKm(c.discoveryRadiusKm)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Cidades no raio (IBGE)</dt>
          <dd className="font-semibold text-ink tabular-nums">{c.eligibleTotal}</dd>
        </div>
        {cityStatuses.map((s) => (
          <div key={s}>
            <dt className="text-ink-muted">{CITY_STATUS_LABEL[s]}s</dt>
            <dd className={`font-semibold tabular-nums ${statusTone[s]}`}>{c.byStatus[s]}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-ink-muted">
        Distâncias calculadas por Haversine entre as sedes municipais da base IBGE. A área de entrega é definida por cada
        estabelecimento e não depende do raio de descoberta.
      </p>
      {c.missingEligible.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-3 text-sm">
          <AlertTriangle aria-hidden="true" className="size-4 text-danger" />
          <span className="min-w-0 flex-1">
            {c.missingEligible.length} município(s) do raio ainda não cadastrado(s):{' '}
            {c.missingEligible.slice(0, 5).map((m) => `${m.name}/${m.state}`).join(', ')}
            {c.missingEligible.length > 5 ? '…' : ''}
          </span>
          <button type="button" onClick={() => sync.mutate()} disabled={sync.isPending} className={secondaryButton}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Cadastrar como planejadas
          </button>
        </div>
      )}
      {c.withoutIbge.length > 0 && (
        <section aria-label="Cidades sem código IBGE" className="flex flex-col gap-2 rounded-xl border border-line p-3">
          <h2 className="text-sm font-semibold text-ink">Cidades antigas sem código IBGE</h2>
          <p className="text-xs text-ink-muted">Só podem ser ativadas depois de vinculadas. O servidor confere nome e UF com a base oficial.</p>
          {c.withoutIbge.map((city) => <LinkIbgeForm key={city.id} city={city} />)}
        </section>
      )}
      {c.outsideArea.length > 0 && (
        <p className="text-sm text-ink-muted">
          Fora da área de atendimento (mantidas como estavam):{' '}
          {c.outsideArea.map((o) => `${o.name}/${o.state} (${formatKm(o.distance_km)}, ${CITY_STATUS_LABEL[o.status].toLowerCase()})`).join(', ')}
        </p>
      )}
      {c.coordinatesDivergent.length > 0 && (
        <p className="text-sm text-ink-muted">
          Centro diferente da sede IBGE (mais de 5 km):{' '}
          {c.coordinatesDivergent.map((o) => `${o.name}/${o.state} (${formatKm(o.offset_km)})`).join(', ')}
        </p>
      )}
    </Panel>
  )
}

function StatusActions({ city }: { city: AdminCity }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [suspending, setSuspending] = useState(false)
  const [reason, setReason] = useState('')
  const m = useMutation({
    mutationFn: ({ to, why }: { to: CityStatus; why?: string }) => setCityStatus(city.id, to, why),
    onSuccess: (to) => {
      toast.success(`${city.name}: ${CITY_STATUS_LABEL[to].toLowerCase()}.`)
      setSuspending(false)
      setReason('')
      invalidate()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (suspending) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (reason.trim()) m.mutate({ to: 'suspended', why: reason })
        }}
        className="flex flex-wrap justify-end gap-2"
      >
        <label htmlFor={`reason-${city.id}`} className="sr-only">Motivo da suspensão de {city.name}</label>
        <input id={`reason-${city.id}`} required maxLength={500} placeholder="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} className={`${inputClass} w-44`} />
        <button type="submit" disabled={m.isPending} className={dangerButton}>Confirmar</button>
        <button type="button" onClick={() => setSuspending(false)} className={secondaryButton}>Cancelar</button>
      </form>
    )
  }
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {cityActions(city.status).map((a) => (
        <button
          key={a.to}
          type="button"
          disabled={m.isPending}
          aria-label={`${a.label} ${city.name}`}
          onClick={() => (a.to === 'suspended' ? setSuspending(true) : m.mutate({ to: a.to }))}
          className={a.to === 'active' ? primaryButton : a.to === 'suspended' ? dangerButton : secondaryButton}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}

export function AdminCities() {
  const [filters, setFilters] = useState<AdminCityFilters>({ search: '', state: '', status: '', maxDistanceKm: null })
  const set = <K extends keyof AdminCityFilters>(k: K, v: AdminCityFilters[K]) => setFilters((p) => ({ ...p, [k]: v }))
  const q = useQuery({ queryKey: ['admin', 'cities', filters], queryFn: () => listCities(filters) })
  const rows = q.data ?? []
  return (
    <>
      <AdminHeader
        title="Cidades"
        subtitle="Municípios de MG e SP a até 100 km da sede, da base IBGE. Ative progressivamente; só cidades ativas aparecem para os clientes."
      />
      <CoveragePanel />
      <div role="search" className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
        <label className="sm:col-span-1">
          <span className="mb-1 block text-sm font-medium text-ink">Cidade ou código IBGE</span>
          <input type="search" value={filters.search} onChange={(e) => set('search', e.target.value)} className={inputClass} />
        </label>
        <label>
          <span className="mb-1 block text-sm font-medium text-ink">UF</span>
          <select value={filters.state} onChange={(e) => set('state', e.target.value)} className={inputClass}>
            <option value="">Todas</option>
            <option value="MG">MG</option>
            <option value="SP">SP</option>
          </select>
        </label>
        <label>
          <span className="mb-1 block text-sm font-medium text-ink">Situação</span>
          <select value={filters.status} onChange={(e) => set('status', e.target.value as CityStatus | '')} className={inputClass}>
            <option value="">Todas</option>
            {cityStatuses.map((s) => <option key={s} value={s}>{CITY_STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-sm font-medium text-ink">Distância da sede</span>
          <select
            value={filters.maxDistanceKm ?? ''}
            onChange={(e) => set('maxDistanceKm', e.target.value ? Number(e.target.value) : null)}
            className={inputClass}
          >
            <option value="">Qualquer</option>
            {DISTANCE_BANDS.map((km) => <option key={km} value={km}>Até {km} km</option>)}
          </select>
        </label>
      </div>
      {q.isLoading ? (
        <p role="status" className="text-sm text-ink-muted">Carregando…</p>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={MapPinned} title="Nenhuma cidade encontrada" />
      ) : (
        <>
          <p className="mb-2 text-sm text-ink-muted" aria-live="polite">{rows[0]?.totalCount ?? rows.length} cidade(s)</p>
          <div className="overflow-x-auto rounded-card border border-line bg-surface">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="border-b border-line text-ink-muted">
                <tr>
                  <th scope="col" className="p-3 font-semibold">Cidade</th>
                  <th scope="col" className="p-3 font-semibold">IBGE</th>
                  <th scope="col" className="p-3 font-semibold">Distância da sede</th>
                  <th scope="col" className="p-3 font-semibold">Situação</th>
                  <th scope="col" className="p-3 font-semibold">Estabelecimentos ativos</th>
                  <th scope="col" className="p-3"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0">
                    <td className="p-3 font-semibold text-ink">{c.name}, {c.state}</td>
                    <td className="p-3 tabular-nums text-ink-muted">{c.ibgeCode ?? 'Sem código'}</td>
                    <td className="p-3 tabular-nums">{formatKm(c.distanceFromHqKm)}</td>
                    <td className={`p-3 ${statusTone[c.status]}`}>{CITY_STATUS_LABEL[c.status]}</td>
                    <td className="p-3 tabular-nums">{c.businessesActive}</td>
                    <td className="p-3 text-right"><StatusActions city={c} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}
