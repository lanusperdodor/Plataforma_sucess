import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, MapPinned, Plus, Search, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useToast } from '../../components/feedback/toast-context.ts'
import {
  getCoverageSummary, getRegionMap, listRegionMunicipalities, listRegions, listUncovered, REGION_STATUS_LABEL, saveRegion, searchMunicipalities,
  setRegionMember, setRegionStatus, suggestRegions, type CoverageSummary, type Municipality, type Region, type RegionCircle, type RegionStatus, type Suggestion,
} from '../../features/regions/repository.ts'
import { AdminHeader, errorMessage, inputClass, Pager, Panel, primaryButton, secondaryButton } from './ui.tsx'

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']
const STATUS_DOT: Record<RegionStatus, string> = { ativa: 'bg-success', rascunho: 'bg-ink-muted', pausada: 'bg-warm', desativada: 'bg-danger' }
const nf = new Intl.NumberFormat('pt-BR')

function useDebounced<T>(v: T, ms = 300): T {
  const [d, setD] = useState(v)
  useEffect(() => { const t = globalThis.setTimeout(() => setD(v), ms); return () => globalThis.clearTimeout(t) }, [v, ms])
  return d
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="rounded-xl bg-muted p-3"><dt className="text-xs text-ink-muted">{label}</dt><dd className="text-xl font-bold tabular-nums text-ink">{value}</dd>{hint && <p className="text-xs text-ink-muted">{hint}</p>}</div>
}

/** Mapa esquemático do Brasil (projeção simples lat/lng): círculos das regiões e UFs com lacunas. Sem polígonos. */
function CoverageMap({ circles, ufs }: { circles: RegionCircle[]; ufs: CoverageSummary['por_uf'] }) {
  const [hover, setHover] = useState<string | null>(null)
  const W = 400, H = 400, minLng = -74.5, maxLng = -33.5, maxLat = 6, minLat = -34.5
  const x = (lng: number) => ((lng - minLng) / (maxLng - minLng)) * W
  const y = (lat: number) => ((maxLat - lat) / (maxLat - minLat)) * H
  const kmToPx = (km: number) => (km / 111.32 / (maxLng - minLng)) * W
  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Mapa esquemático com ${circles.length} regiões comerciais`} className="h-auto w-full max-w-md rounded-xl bg-muted">
        {circles.map((c) => (
          <circle key={c.id} cx={x(c.lng)} cy={y(c.lat)} r={Math.max(2, kmToPx(c.radius_km))}
                  className={c.status === 'ativa' ? 'fill-success/30 stroke-success' : c.status === 'pausada' ? 'fill-warm/20 stroke-warm' : 'fill-ink/5 stroke-ink-muted'}
                  strokeWidth={hover === c.id ? 2 : 0.6} onMouseEnter={() => setHover(c.id)} onMouseLeave={() => setHover(null)}>
            <title>{c.name} · {REGION_STATUS_LABEL[c.status as RegionStatus] ?? c.status} · {c.radius_km} km</title>
          </circle>
        ))}
        {ufs.filter((u) => u.lat !== null && u.lng !== null).map((u) => (
          <g key={u.sigla}>
            <text x={x(u.lng!)} y={y(u.lat!)} textAnchor="middle" dominantBaseline="middle" className="fill-ink text-[9px] font-bold">{u.sigla}</text>
            {u.lacunas > 0 && <circle cx={x(u.lng!) + 9} cy={y(u.lat!) - 6} r={3} className="fill-danger"><title>{u.nome}: {u.lacunas} municípios sem raio</title></circle>}
          </g>
        ))}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full bg-success" aria-hidden="true" />Ativa</span>
        <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full bg-warm" aria-hidden="true" />Pausada</span>
        <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full bg-ink-muted" aria-hidden="true" />Rascunho</span>
        <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full bg-danger" aria-hidden="true" />UF com lacunas</span>
        <span>Esquemático (coordenadas das sedes, sem limites estaduais). Raio em linha reta.</span>
      </figcaption>
    </figure>
  )
}

function MunicipalityPicker({ value, onChange }: { value: Municipality | null; onChange: (m: Municipality) => void }) {
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const res = useQuery({ queryKey: ['admin', 'muni-search', dq], queryFn: () => searchMunicipalities(dq), enabled: dq.trim().length >= 2 })
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-ink">Município central
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={value ? `${value.name}/${value.uf}` : 'Buscar município (sem acento também)'} className={`${inputClass} mt-1`} />
      </label>
      {value && <p className="text-xs text-ink-muted">Selecionado: <strong className="text-ink">{value.name}/{value.uf}</strong> (IBGE {value.ibge_code})</p>}
      {(res.data ?? []).length > 0 && q && (
        <ul className="max-h-48 overflow-y-auto rounded-xl border border-line">
          {res.data!.map((m) => (
            <li key={m.ibge_code}><button type="button" onClick={() => { onChange(m); setQ('') }} className="w-full px-3 py-2 text-left text-sm text-ink hover:bg-muted">{m.name}/{m.uf}{m.is_capital ? ' · capital' : ''}</button></li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('h2')?.focus()
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[var(--z-sheet)] flex justify-end">
      <button type="button" aria-label="Fechar" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/30" />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-surface shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-surface px-4 py-3">
          <h2 tabIndex={-1} className="text-lg font-bold text-ink outline-none">{title}</h2>
          <button type="button" onClick={onClose} className="pressable grid size-11 place-items-center rounded-full hover:bg-muted" aria-label="Fechar painel"><X aria-hidden="true" className="size-5" /></button>
        </div>
        <div className="flex flex-col gap-4 p-4">{children}</div>
      </div>
    </div>
  )
}

function RegionEditor({ region, onDone }: { region: Region | null; onDone: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState(region?.name ?? '')
  const [radius, setRadius] = useState(String(region?.radius_km ?? 100))
  const [center, setCenter] = useState<Municipality | null>(region?.center_ibge ? { ibge_code: region.center_ibge, name: region.center_name ?? '', uf: region.uf ?? '', lat: region.center_lat, lng: region.center_lng, is_capital: false } : null)
  const save = useMutation({
    mutationFn: () => saveRegion(region?.id ?? null, name, center!.ibge_code, Number(radius.replace(',', '.'))),
    onSuccess: () => { toast.success(region ? 'Região atualizada.' : 'Região criada como rascunho.'); void qc.invalidateQueries({ queryKey: ['admin', 'regions'] }); onDone() },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="flex flex-col gap-3">
      {region?.in_use && <p className="flex items-start gap-2 rounded-xl bg-muted p-3 text-sm text-ink"><Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Há campanhas em andamento: centro e raio ficam travados até elas terminarem. O nome pode mudar.</p>}
      <label className="text-sm font-medium text-ink">Nome<input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} className={`${inputClass} mt-1`} /></label>
      <MunicipalityPicker value={center} onChange={(m) => { setCenter(m); if (!name) setName(`Região de ${m.name}`) }} />
      <label className="text-sm font-medium text-ink">Raio (km, em linha reta)<input value={radius} onChange={(e) => setRadius(e.target.value)} inputMode="decimal" className={`${inputClass} mt-1`} /></label>
      <p className="text-xs text-ink-muted">Novas regiões nascem como rascunho. Ative só quando houver operação real na região.</p>
      <button type="submit" disabled={save.isPending || !center || !name.trim()} className={primaryButton}>{region ? 'Salvar' : 'Criar região'}</button>
    </form>
  )
}

function RegionMembers({ region }: { region: Region }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const dq = useDebounced(q)
  const list = useQuery({ queryKey: ['admin', 'regions', 'members', region.id, dq, page], queryFn: () => listRegionMunicipalities(region.id, dq, page, 25) })
  const [add, setAdd] = useState<Municipality | null>(null)
  const member = useMutation({
    mutationFn: (a: { ibge: number; include: boolean }) => setRegionMember(region.id, a.ibge, a.include),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin', 'regions'] }); setAdd(null) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const total = list.data?.[0]?.total_count ?? 0
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink">{region.center_name}/{region.uf} · raio {region.radius_km} km · {nf.format(region.municipalities)} municípios · {region.businesses} estabelecimentos ativos · {region.active_campaigns} campanhas ativas</p>
      {region.kind === 'raio' && (
        <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
          <MunicipalityPicker value={add} onChange={setAdd} />
          <button type="button" disabled={!add || member.isPending} onClick={() => add && member.mutate({ ibge: add.ibge_code, include: true })} className={`${secondaryButton} self-start`}><Plus aria-hidden="true" className="size-4" />Incluir manualmente</button>
        </div>
      )}
      <label className="relative">
        <span className="sr-only">Buscar município na região</span>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder="Buscar município" className={`${inputClass} pl-9`} />
      </label>
      {list.isError ? <p role="alert" className="text-sm text-danger">{errorMessage(list.error)}</p> : (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {(list.data ?? []).map((m) => (
            <li key={m.ibge_code} className={`flex items-center gap-2 py-2 ${m.excluded ? 'opacity-60' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="text-ink">{m.name}/{m.uf} {m.served_city && <span className="rounded-full bg-muted px-1.5 text-[11px] font-semibold">atendida</span>}</p>
                <p className="text-xs text-ink-muted">{m.distance_km !== null ? `${m.distance_km} km` : 'sem distância'} · {m.source === 'manual' ? 'incluído manualmente' : m.source === 'administrativa' ? 'cobertura administrativa' : 'no raio'}
                  {m.excluded ? ' · retirado' : m.is_primary ? ' · região principal' : m.primary_region ? ` · principal: ${m.primary_region}` : ''}{m.businesses ? ` · ${m.businesses} lojas` : ''}</p>
              </div>
              {region.kind === 'raio' && (
                <button type="button" disabled={member.isPending} onClick={() => member.mutate({ ibge: m.ibge_code, include: m.excluded })} className="pressable min-h-9 rounded-full px-3 text-xs font-semibold text-ink hover:bg-muted">
                  {m.excluded ? 'Incluir' : 'Retirar'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} pageSize={25} total={total} onPage={setPage} loading={list.isFetching} />
    </div>
  )
}

function RegionsTab({ summary }: { summary: CoverageSummary | undefined }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [uf, setUf] = useState('')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const dq = useDebounced(q)
  const [sheet, setSheet] = useState<{ kind: 'edit' | 'members'; region: Region | null } | null>(null)
  const list = useQuery({ queryKey: ['admin', 'regions', 'list', uf, status, dq, page], queryFn: () => listRegions({ uf, status, q: dq, page, pageSize: 12 }) })
  const map = useQuery({ queryKey: ['admin', 'regions', 'map'], queryFn: getRegionMap })
  const change = useMutation({
    mutationFn: (a: { id: string; status: RegionStatus }) => setRegionStatus(a.id, a.status),
    onSuccess: (_v, a) => { toast.success(`Região ${REGION_STATUS_LABEL[a.status].toLowerCase()}.`); void qc.invalidateQueries({ queryKey: ['admin', 'regions'] }) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const total = list.data?.[0]?.total_count ?? 0
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <Panel>{map.data && summary ? <CoverageMap circles={map.data} ufs={summary.por_uf} /> : <p className="text-sm text-ink-muted">Carregando mapa…</p>}</Panel>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[8rem_10rem_1fr_auto]">
            <label className="text-sm font-medium text-ink">UF<select value={uf} onChange={(e) => { setUf(e.target.value); setPage(1) }} className={`${inputClass} mt-1`}><option value="">Todas</option>{UFS.map((u) => <option key={u}>{u}</option>)}</select></label>
            <label className="text-sm font-medium text-ink">Situação<select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className={`${inputClass} mt-1`}><option value="">Todas</option>{(Object.keys(REGION_STATUS_LABEL) as RegionStatus[]).map((s) => <option key={s} value={s}>{REGION_STATUS_LABEL[s]}</option>)}</select></label>
            <label className="text-sm font-medium text-ink">Região ou cidade<input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder="Ex.: itau, sao paulo" className={`${inputClass} mt-1`} /></label>
            <button type="button" onClick={() => setSheet({ kind: 'edit', region: null })} className={`${primaryButton} self-end`}><Plus aria-hidden="true" className="size-4" />Nova região</button>
          </div>
          {list.isError ? <p role="alert" className="text-sm text-danger">{errorMessage(list.error)}</p> : (list.data ?? []).length === 0 ? (
            <p className="rounded-xl bg-muted p-4 text-sm text-ink">{list.isLoading ? 'Carregando…' : summary && summary.municipios === 0 ? 'A base de municípios do IBGE ainda não foi importada (supabase/admin/municipios_ibge.sql).' : 'Nenhuma região encontrada.'}</p>
          ) : (
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
              {list.data!.map((r) => (
                <li key={r.id} className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">{r.name}</p>
                      <p className="text-xs text-ink-muted">{r.kind === 'administrativa' ? 'Cobertura administrativa (lacunas)' : `${r.center_name}/${r.uf} · ${r.radius_km} km`}{r.suggested ? ' · sugerida' : ''}</p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-ink"><span className={`size-2 rounded-full ${STATUS_DOT[r.status]}`} aria-hidden="true" />{REGION_STATUS_LABEL[r.status]}</span>
                  </div>
                  <p className="text-xs text-ink-muted">{nf.format(r.municipalities)} municípios ({nf.format(r.primary_municipalities)} principais) · {r.businesses} lojas ativas · {r.active_campaigns} campanhas{r.in_use ? ' · em uso' : ''}</p>
                  <div className="mt-auto flex flex-wrap gap-1">
                    <button type="button" onClick={() => setSheet({ kind: 'members', region: r })} className="pressable min-h-9 rounded-full border border-line px-3 text-xs font-semibold text-ink">Municípios</button>
                    {r.kind === 'raio' && <>
                      <button type="button" onClick={() => setSheet({ kind: 'edit', region: r })} className="pressable min-h-9 rounded-full border border-line px-3 text-xs font-semibold text-ink">Editar</button>
                      {r.status !== 'ativa' && <button type="button" disabled={change.isPending} onClick={() => change.mutate({ id: r.id, status: 'ativa' })} className="pressable min-h-9 rounded-full bg-brand px-3 text-xs font-semibold text-surface">Ativar</button>}
                      {r.status === 'ativa' && <button type="button" disabled={change.isPending || r.in_use} title={r.in_use ? 'Há campanhas pagas em andamento' : undefined} onClick={() => change.mutate({ id: r.id, status: 'pausada' })} className="pressable min-h-9 rounded-full border border-line px-3 text-xs font-semibold text-ink disabled:opacity-50">Pausar</button>}
                      {r.status !== 'desativada' && r.status !== 'ativa' && <button type="button" disabled={change.isPending} onClick={() => { if (window.confirm(`Desativar ${r.name}?`)) change.mutate({ id: r.id, status: 'desativada' }) }} className="pressable min-h-9 rounded-full px-3 text-xs font-semibold text-danger hover:bg-muted">Desativar</button>}
                    </>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Pager page={page} pageSize={12} total={total} onPage={setPage} loading={list.isFetching} />
        </div>
      </div>
      {sheet?.kind === 'edit' && <Sheet title={sheet.region ? `Editar ${sheet.region.name}` : 'Nova região comercial'} onClose={() => setSheet(null)}><RegionEditor region={sheet.region} onDone={() => setSheet(null)} /></Sheet>}
      {sheet?.kind === 'members' && sheet.region && <Sheet title={sheet.region.name} onClose={() => setSheet(null)}><RegionMembers region={sheet.region} /></Sheet>}
    </div>
  )
}

function GapsTab() {
  const [uf, setUf] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const dq = useDebounced(q)
  const list = useQuery({ queryKey: ['admin', 'regions', 'gaps', uf, dq, page], queryFn: () => listUncovered(uf, dq, page, 30) })
  const total = list.data?.[0]?.total_count ?? 0
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">Municípios fora de qualquer raio vigente. Ficam na cobertura administrativa da UF — isto é uma lacuna, não uma cobertura comercial.</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[8rem_1fr]">
        <label className="text-sm font-medium text-ink">UF<select value={uf} onChange={(e) => { setUf(e.target.value); setPage(1) }} className={`${inputClass} mt-1`}><option value="">Todas</option>{UFS.map((u) => <option key={u}>{u}</option>)}</select></label>
        <label className="text-sm font-medium text-ink">Município<input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} className={`${inputClass} mt-1`} /></label>
      </div>
      {list.isError ? <p role="alert" className="text-sm text-danger">{errorMessage(list.error)}</p> : (
        <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {(list.data ?? []).length === 0 && <li className="text-ink-muted">{list.isLoading ? 'Carregando…' : 'Nenhuma lacuna.'}</li>}
          {(list.data ?? []).map((m) => <li key={m.ibge_code} className="rounded-lg bg-muted px-3 py-2 text-ink">{m.name}/{m.uf}<span className="block text-xs text-ink-muted">{m.reason === 'sem_coordenadas' ? 'sem coordenadas na base' : 'fora dos raios'}</span></li>)}
        </ul>
      )}
      <Pager page={page} pageSize={30} total={total} onPage={setPage} loading={list.isFetching} />
    </div>
  )
}

function GeneratorTab() {
  const qc = useQueryClient()
  const toast = useToast()
  const [radius, setRadius] = useState('100')
  const [uf, setUf] = useState('')
  const [max, setMax] = useState('20')
  const [preview, setPreview] = useState<Suggestion[] | null>(null)
  const run = useMutation({
    mutationFn: (create: boolean) => suggestRegions(Number(radius), Number(max), uf, create),
    onSuccess: (rows, create) => {
      setPreview(rows)
      if (create) { toast.success(`${rows.length} regiões criadas como rascunho.`); void qc.invalidateQueries({ queryKey: ['admin', 'regions'] }) }
      else if (rows.length === 0) toast.success('Todos os municípios com coordenadas já estão em algum raio.')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">Sugere centros regionais entre os municípios ainda sem raio (cada sugestão cobre o máximo de municípios descobertos). Nada é ativado: as regiões criadas ficam como rascunho.</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[8rem_8rem_8rem_auto_auto] sm:items-end">
        <label className="text-sm font-medium text-ink">Raio (km)<input value={radius} onChange={(e) => setRadius(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" className={`${inputClass} mt-1`} /></label>
        <label className="text-sm font-medium text-ink">UF<select value={uf} onChange={(e) => setUf(e.target.value)} className={`${inputClass} mt-1`}><option value="">Brasil</option>{UFS.map((u) => <option key={u}>{u}</option>)}</select></label>
        <label className="text-sm font-medium text-ink">Até<input value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" className={`${inputClass} mt-1`} /></label>
        <button type="button" disabled={run.isPending} onClick={() => run.mutate(false)} className={secondaryButton}><Sparkles aria-hidden="true" className="size-4" />Prever</button>
        <button type="button" disabled={run.isPending || !preview?.length} onClick={() => { if (window.confirm('Criar estas regiões como rascunho?')) run.mutate(true) }} className={primaryButton}>Criar como rascunho</button>
      </div>
      {preview && (
        <ol className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {preview.map((s) => <li key={s.seq} className="rounded-lg bg-muted px-3 py-2 text-ink">{s.seq}. {s.center_name}/{s.uf}<span className="block text-xs text-ink-muted">+{s.newly_covered} municípios descobertos{s.region_id ? ' · criada' : ''}</span></li>)}
        </ol>
      )}
    </div>
  )
}

/** Administração → Regiões: cobertura nacional (IBGE) e regiões comerciais. */
export function AdminRegions() {
  const [tab, setTab] = useState<'regioes' | 'lacunas' | 'gerador'>('regioes')
  const summary = useQuery({ queryKey: ['admin', 'regions', 'summary'], queryFn: getCoverageSummary })
  const s = summary.data
  const pct = useMemo(() => (s && s.municipios ? Math.round((s.em_raio / s.municipios) * 1000) / 10 : 0), [s])
  return (
    <div className="flex flex-col gap-5">
      <AdminHeader title="Regiões" subtitle="Brasil → UF → região comercial → município. Base oficial do IBGE; raio em linha reta." />
      {summary.isError ? <Panel><p role="alert" className="text-sm text-danger">{errorMessage(summary.error)}</p></Panel> : s && (
        <dl className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Municípios cadastrados (IBGE)" value={nf.format(s.municipios)} />
          <Stat label="Dentro de algum raio" value={nf.format(s.em_raio)} hint={`${pct}% da base`} />
          <Stat label="Em regiões ativas" value={nf.format(s.em_regiao_ativa)} />
          <Stat label="Lacunas (só administrativa)" value={nf.format(s.lacunas)} hint={s.sem_coordenadas ? `${s.sem_coordenadas} sem coordenadas` : undefined} />
          <Stat label="Cidades atendidas" value={nf.format(s.cidades_atendidas)} hint={`${s.cidades_com_ibge} ligadas ao IBGE`} />
          <Stat label="Cidades com loja operando" value={nf.format(s.cidades_operacionais)} hint="O raio de entrega é de cada loja" />
        </dl>
      )}
      <div role="tablist" aria-label="Seções de regiões" className="flex gap-2">
        {([['regioes', 'Regiões'], ['lacunas', 'Lacunas'], ['gerador', 'Gerador']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} className={tab === k ? primaryButton : secondaryButton}>
            {k === 'regioes' && <MapPinned aria-hidden="true" className="size-4" />}{l}
          </button>
        ))}
      </div>
      {tab === 'regioes' && <RegionsTab summary={s} />}
      {tab === 'lacunas' && <Panel><GapsTab /></Panel>}
      {tab === 'gerador' && <Panel><GeneratorTab /></Panel>}
    </div>
  )
}
