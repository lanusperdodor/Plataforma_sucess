import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Megaphone, Rocket, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { AD_STATUS_LABEL, cancelCampaign, createCampaign, getAdQuote, listCampaigns, OBJECTIVE_LABEL, type AdObjective, type AdStatus } from '../../features/ads/repository.ts'
import { useAuth } from '../../features/auth/AuthProvider.tsx'
import { listFeed } from '../../features/conecta/repository.ts'
import { createPaymentLink } from '../../features/payments/repository.ts'
import { listActiveRegions, type ActiveRegion } from '../../features/regions/repository.ts'
import { formatBRL } from '../../lib/money.ts'
import { useGestao } from './context.ts'
import { box, field, hhmm, msg, parseCents, primary, secondary, SectionTitle } from './ui.tsx'

const nf = new Intl.NumberFormat('pt-BR')
const dateBr = (iso: string | null) => (iso ? `${new Date(iso).toLocaleDateString('pt-BR')} ${hhmm(iso)}` : '—')

function useDebounced<T>(v: T, ms = 300): T {
  const [d, setD] = useState(v)
  useEffect(() => { const t = globalThis.setTimeout(() => setD(v), ms); return () => globalThis.clearTimeout(t) }, [v, ms])
  return d
}

function RegionPicker({ value, onChange }: { value: ActiveRegion[]; onChange: (v: ActiveRegion[]) => void }) {
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const res = useQuery({ queryKey: ['ads', 'regions', dq], queryFn: () => listActiveRegions(dq) })
  const options = (res.data ?? []).filter((r) => !value.some((v) => v.id === r.id))
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-ink">Regiões comerciais</legend>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {value.map((r) => (
            <li key={r.id} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm text-ink">
              {r.name}/{r.uf}
              <button type="button" onClick={() => onChange(value.filter((v) => v.id !== r.id))} aria-label={`Remover ${r.name}`} className="grid size-6 place-items-center rounded-full hover:bg-surface"><X aria-hidden="true" className="size-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      <label className="relative">
        <span className="sr-only">Buscar região ou cidade</span>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar região ou cidade" className={`${field} pl-9`} />
      </label>
      {res.isError ? <p role="alert" className="text-sm text-danger">{msg(res.error)}</p> : (
        <ul className="max-h-48 overflow-y-auto rounded-xl border border-line">
          {options.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">{res.isLoading ? 'Carregando…' : 'Nenhuma região ativa encontrada.'}</li>}
          {options.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => { onChange([...value, r]); setQ('') }} className="w-full px-3 py-2 text-left text-sm text-ink hover:bg-muted">
                {r.name}/{r.uf} <span className="text-ink-muted">· {nf.format(r.municipalities)} municípios{r.radius_km ? ` · ${r.radius_km} km` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}

function BoostForm({ initialPost, onDone }: { initialPost: string | null; onDone: () => void }) {
  const { business: b } = useGestao()
  const { session } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const posts = useQuery({ queryKey: ['ads', 'posts', b.id], queryFn: () => listFeed({ kind: 'business', businessId: b.id }, session?.user.id ?? null) })
  const [post, setPost] = useState(initialPost ?? '')
  const [objective, setObjective] = useState<AdObjective>('alcance')
  const [regions, setRegions] = useState<ActiveRegion[]>([])
  const [days, setDays] = useState('2')
  const [total, setTotal] = useState('10,00')
  const [opId] = useState(() => globalThis.crypto.randomUUID())
  const cents = parseCents(total) ?? 0
  const nDays = Number(days) || 0
  const quote = useQuery({
    queryKey: ['ads', 'quote', regions.map((r) => r.id).join(','), nDays, cents],
    queryFn: () => getAdQuote(regions.map((r) => r.id), nDays, cents),
    enabled: regions.length > 0 && nDays > 0,
  })
  const create = useMutation({
    mutationFn: async () => {
      const r = await createCampaign({ businessId: b.id, postId: post, objective, regions: regions.map((x) => x.id), days: nDays, totalCents: cents, opId })
      void qc.invalidateQueries({ queryKey: ['ads', 'campaigns', b.id] })
      return createPaymentLink(r.charge_id).catch(() => null)
    },
    onSuccess: (url) => {
      if (url) window.location.assign(url)
      else { toast.success('Campanha criada. Pague a cobrança na lista abaixo para enviar à análise.'); onDone() }
    },
    onError: (e) => toast.error(msg(e)),
  })
  const list = (posts.data?.posts ?? []).filter((p) => !p.hidden)
  const q = quote.data
  return (
    <form onSubmit={(e) => { e.preventDefault(); create.mutate() }} className={`${box} flex flex-col gap-4`} aria-label="Turbinar publicação">
      <h2 className="flex items-center gap-2 text-lg font-bold text-ink"><Rocket aria-hidden="true" className="size-5" />Turbinar publicação</h2>
      <label className="text-sm font-medium text-ink">Publicação do estabelecimento
        <select value={post} onChange={(e) => setPost(e.target.value)} required className={`${field} mt-1`}>
          <option value="">{posts.isLoading ? 'Carregando…' : list.length ? 'Escolha a publicação' : 'Publique algo no Conecta como o estabelecimento primeiro'}</option>
          {list.map((p) => <option key={p.id} value={p.id}>{p.body.slice(0, 80)}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium text-ink">Objetivo
        <select value={objective} onChange={(e) => setObjective(e.target.value as AdObjective)} className={`${field} mt-1`}>
          {(Object.keys(OBJECTIVE_LABEL) as AdObjective[]).map((k) => <option key={k} value={k}>{OBJECTIVE_LABEL[k]}</option>)}
        </select>
      </label>
      <RegionPicker value={regions} onChange={setRegions} />
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-medium text-ink">Duração (dias)<input value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 2))} inputMode="numeric" className={`${field} mt-1`} /></label>
        <label className="text-sm font-medium text-ink">Orçamento total (R$)<input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" className={`${field} mt-1`} /></label>
      </div>
      <div aria-live="polite" className="rounded-xl bg-muted p-3 text-sm text-ink">
        {regions.length === 0 ? 'Escolha ao menos uma região ativa para ver o preço.' : !q ? 'Calculando…' : (
          <>
            <p>Orçamento diário: <strong>{q.daily_cents !== null ? formatBRL(q.daily_cents) : '—'}</strong> · Mínimo para {q.regions} região(ões) e {nDays} dia(s): <strong>{formatBRL(q.min_cents)}</strong></p>
            <p className="mt-1">Preço final: <strong className="text-base">{formatBRL(cents)}</strong>{!q.ok && <span className="text-danger"> — ajuste o orçamento, a duração ({q.min_days}–{q.max_days} dias) ou as regiões (até {q.max_regions}).</span>}</p>
          </>
        )}
        <p className="mt-2 text-xs text-ink-muted">Cobrança fixa pelo período e pelas regiões contratadas. Não há garantia de alcance ou de resultados. A publicação aparece com a etiqueta “Patrocinado” só depois do pagamento confirmado e da aprovação da Tucaí; o período começa na ativação.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={create.isPending || !post || !q?.ok} className={primary}>{create.isPending ? 'Abrindo pagamento…' : `Contratar e pagar ${formatBRL(cents)}`}</button>
        <button type="button" onClick={onDone} className={secondary}>Cancelar</button>
      </div>
    </form>
  )
}

/** Anúncios do estabelecimento: Turbinar publicação e painel do anunciante (métricas verificáveis do banco). */
export function AdsTab() {
  const { business: b } = useGestao()
  const toast = useToast()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const preset = params.get('post')
  const [creating, setCreating] = useState(!!preset)
  const list = useQuery({ queryKey: ['ads', 'campaigns', b.id], queryFn: () => listCampaigns(b.id), refetchInterval: 60_000 })
  const pay = useMutation({ mutationFn: createPaymentLink, onSuccess: (url) => window.location.assign(url), onError: (e) => toast.error(msg(e)) })
  const cancel = useMutation({
    mutationFn: cancelCampaign,
    onSuccess: () => { toast.success('Campanha cancelada e cobrança anulada.'); void qc.invalidateQueries({ queryKey: ['ads', 'campaigns', b.id] }) },
    onError: (e) => toast.error(msg(e)),
  })
  const rows = list.data ?? []
  const totals = rows.reduce((acc, c) => ({ inv: acc.inv + (c.paid ? c.total_cents : 0), imp: acc.imp + c.impressions, cli: acc.cli + c.clicks }), { inv: 0, imp: 0, cli: 0 })
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle
        title="Anúncios"
        subtitle="Publicações patrocinadas no Conecta para as regiões que você escolher."
        actions={!creating && <button type="button" onClick={() => setCreating(true)} className={primary}><Rocket aria-hidden="true" className="size-4" />Turbinar publicação</button>}
      />
      {creating && <BoostForm initialPost={preset} onDone={() => { setCreating(false); if (preset) setParams({}, { replace: true }) }} />}
      <dl className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-muted p-3"><dt className="text-xs text-ink-muted">Investido (pago)</dt><dd className="text-lg font-bold tabular-nums text-ink">{formatBRL(totals.inv)}</dd></div>
        <div className="rounded-xl bg-muted p-3"><dt className="text-xs text-ink-muted">Impressões únicas</dt><dd className="text-lg font-bold tabular-nums text-ink">{nf.format(totals.imp)}</dd></div>
        <div className="rounded-xl bg-muted p-3"><dt className="text-xs text-ink-muted">Cliques únicos</dt><dd className="text-lg font-bold tabular-nums text-ink">{nf.format(totals.cli)}</dd></div>
      </dl>
      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={Megaphone} title={list.isLoading ? 'Carregando…' : 'Nenhuma campanha ainda'} description="Escolha uma publicação do estabelecimento e as regiões para começar." />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((c) => (
            <li key={c.id} className={`${box} flex flex-col gap-2`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-sm text-ink">“{c.post_excerpt ?? 'publicação removida'}”</p>
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-ink">{AD_STATUS_LABEL[c.status as AdStatus] ?? c.status}</span>
              </div>
              <p className="text-sm text-ink">{formatBRL(c.total_cents)} · {c.days} dia(s) · {formatBRL(c.daily_cents)}/dia · {(c.regions ?? []).join(', ')}</p>
              <p className="text-xs text-ink-muted">
                {OBJECTIVE_LABEL[c.objective as AdObjective] ?? c.objective} · {c.starts_at ? `de ${dateBr(c.starts_at)} a ${dateBr(c.ends_at)}` : 'período começa na ativação'} · {nf.format(c.impressions)} impressões · {nf.format(c.clicks)} cliques
                {c.impressions > 0 ? ` · ${(Math.round((c.clicks / c.impressions) * 1000) / 10).toLocaleString('pt-BR')}% de cliques` : ''}
              </p>
              {c.review_note && <p className="text-sm text-ink">Nota da Tucaí: {c.review_note}</p>}
              {c.status === 'aguardando_pagamento' && c.charge_id && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={pay.isPending} onClick={() => pay.mutate(c.charge_id!)} className={primary}>Pagar {formatBRL(c.total_cents)}</button>
                  <button type="button" disabled={cancel.isPending} onClick={() => { if (window.confirm('Cancelar esta campanha?')) cancel.mutate(c.id) }} className={secondary}>Cancelar</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-muted">Impressões e cliques são contados uma vez por pessoa por dia; visualizações da sua equipe não entram.</p>
    </div>
  )
}
