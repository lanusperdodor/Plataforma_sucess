import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useToast } from '../../components/feedback/toast-context.ts'
import {
  AD_STATUS_LABEL, getAdsSummary, listAdminCampaigns, OBJECTIVE_LABEL, reviewCampaign, saveAdSettings, setCampaignStatus,
  type AdObjective, type AdStatus, type AdsSummary,
} from '../../features/ads/repository.ts'
import { formatBRL } from '../../lib/money.ts'
import { AdminHeader, errorMessage, formatDateTime, inputClass, Pager, Panel, primaryButton, secondaryButton } from './ui.tsx'

const nf = new Intl.NumberFormat('pt-BR')

function Settings({ config }: { config: AdsSummary['config'] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [c, setC] = useState(config)
  const save = useMutation({
    mutationFn: () => saveAdSettings(c),
    onSuccess: () => { toast.success('Regras de anúncios salvas.'); void qc.invalidateQueries({ queryKey: ['admin', 'ads'] }) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const num = (k: keyof AdsSummary['config'], label: string, money = false) => (
    <label className="text-sm font-medium text-ink">{label}
      <input inputMode="numeric" value={money ? String(c[k] / 100) : String(c[k])}
             onChange={(e) => { const v = Number(e.target.value.replace(',', '.')) || 0; setC({ ...c, [k]: money ? Math.round(v * 100) : Math.round(v) }) }}
             className={`${inputClass} mt-1`} />
    </label>
  )
  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {num('min_total_cents', 'Mínimo por campanha (R$)', true)}
      {num('min_daily_cents_per_region', 'Mínimo por dia e região (R$)', true)}
      {num('min_days', 'Dias mínimos')}
      {num('max_days', 'Dias máximos')}
      {num('max_regions', 'Regiões por campanha')}
      {num('feed_every', '1 patrocinado a cada N publicações')}
      {num('max_campaigns_per_viewer_day', 'Campanhas diferentes por pessoa/dia')}
      <button type="submit" disabled={save.isPending} className={`${primaryButton} self-end`}>Salvar regras</button>
      <p className="col-span-full text-xs text-ink-muted">Cobrança fixa pelo período e regiões contratados, sem promessa de alcance. As regras valem para novas campanhas.</p>
    </form>
  )
}

/** Administração → Anúncios: moderação, preços, campanhas, receitas e métricas. */
export function AdminAds() {
  const qc = useQueryClient()
  const toast = useToast()
  const summary = useQuery({ queryKey: ['admin', 'ads', 'summary'], queryFn: getAdsSummary })
  const [status, setStatus] = useState('aguardando_aprovacao')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const list = useQuery({ queryKey: ['admin', 'ads', 'list', status, q, page], queryFn: () => listAdminCampaigns({ status, q, page, pageSize: 15 }) })
  const act = useMutation({
    mutationFn: async (a: { id: string; kind: 'aprovar' | 'recusar' | 'pausar' | 'retomar' | 'encerrar' }) => {
      if (a.kind === 'aprovar') return reviewCampaign(a.id, true, '')
      const note = window.prompt(a.kind === 'recusar' ? 'Motivo da recusa (o anunciante verá):' : 'Motivo:')?.trim() ?? ''
      if (!note) throw new Error('Informe o motivo.')
      if (a.kind === 'recusar') return reviewCampaign(a.id, false, note)
      await setCampaignStatus(a.id, a.kind === 'pausar' ? 'pausada' : a.kind === 'retomar' ? 'ativa' : 'encerrada', note)
      return a.kind
    },
    onSuccess: (r) => {
      toast.success(r === 'recusada_reembolso_pendente' ? 'Recusada. Campanha já paga: faça o reembolso pelo financeiro.' : r === 'aprovada_aguardando_pagamento' ? 'Aprovada; ativa assim que o pagamento for confirmado.' : 'Campanha atualizada.')
      void qc.invalidateQueries({ queryKey: ['admin', 'ads'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const s = summary.data
  const total = list.data?.[0]?.total_count ?? 0
  return (
    <div className="flex flex-col gap-5">
      <AdminHeader title="Anúncios" subtitle="Publicações patrocinadas do Conecta por região comercial." />
      {summary.isError ? <Panel><p role="alert" className="text-sm text-danger">{errorMessage(summary.error)}</p></Panel> : s && (
        <>
          <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              ['Receita total (pagas)', formatBRL(s.receita_cents)], ['Receita no mês', formatBRL(s.receita_mes_cents)], ['Campanhas ativas', nf.format(s.ativas)],
              ['Aguardando aprovação', nf.format(s.aguardando_aprovacao)], ['Aguardando pagamento', nf.format(s.aguardando_pagamento)],
              ['Reembolsos pendentes', nf.format(s.reembolso_pendente)], ['Impressões únicas', nf.format(s.impressoes)], ['Cliques únicos', nf.format(s.cliques)],
            ].map(([l, v]) => <div key={l} className="rounded-xl bg-muted p-3"><dt className="text-xs text-ink-muted">{l}</dt><dd className="text-lg font-bold tabular-nums text-ink">{v}</dd></div>)}
          </dl>
          <Panel><h2 className="mb-3 text-base font-semibold text-ink">Preços e distribuição</h2><Settings key={JSON.stringify(s.config)} config={s.config} /></Panel>
        </>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[14rem_1fr]">
        <label className="text-sm font-medium text-ink">Situação
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className={`${inputClass} mt-1`}>
            <option value="">Todas</option>
            {(Object.keys(AD_STATUS_LABEL) as AdStatus[]).map((k) => <option key={k} value={k}>{AD_STATUS_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-ink">Estabelecimento<input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} className={`${inputClass} mt-1`} /></label>
      </div>
      {list.isError ? <p role="alert" className="text-sm text-danger">{errorMessage(list.error)}</p> : (list.data ?? []).length === 0 ? (
        <Panel><p className="text-sm text-ink-muted">{list.isLoading ? 'Carregando…' : 'Nenhuma campanha nesta situação.'}</p></Panel>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.data!.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{c.business_name}{c.is_test ? ' · teste' : ''}</p>
                  <p className="text-sm text-ink-muted">“{c.post_excerpt ?? 'publicação removida'}”</p>
                </div>
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-ink">{AD_STATUS_LABEL[c.status as AdStatus] ?? c.status}</span>
              </div>
              <p className="text-sm text-ink">{formatBRL(c.total_cents)} · {c.days} dia(s) · {OBJECTIVE_LABEL[c.objective as AdObjective] ?? c.objective} · {(c.regions ?? []).join(', ')}</p>
              <p className="text-xs text-ink-muted">Criada {formatDateTime(c.created_at)}{c.starts_at ? ` · de ${formatDateTime(c.starts_at)} a ${formatDateTime(c.ends_at)}` : ''} · {c.paid ? 'pago' : 'sem pagamento'} · {c.approved ? 'aprovado' : 'não aprovado'} · {nf.format(c.impressions)} impressões · {nf.format(c.clicks)} cliques{c.review_note ? ` · nota: ${c.review_note}` : ''}</p>
              <div className="flex flex-wrap gap-2">
                {(c.status === 'aguardando_aprovacao' || c.status === 'aguardando_pagamento') && !c.approved && <>
                  <button type="button" disabled={act.isPending} onClick={() => act.mutate({ id: c.id, kind: 'aprovar' })} className={primaryButton}>Aprovar</button>
                  <button type="button" disabled={act.isPending} onClick={() => act.mutate({ id: c.id, kind: 'recusar' })} className={secondaryButton}>Recusar</button>
                </>}
                {c.status === 'ativa' && <button type="button" disabled={act.isPending} onClick={() => act.mutate({ id: c.id, kind: 'pausar' })} className={secondaryButton}>Pausar</button>}
                {c.status === 'pausada' && <button type="button" disabled={act.isPending} onClick={() => act.mutate({ id: c.id, kind: 'retomar' })} className={secondaryButton}>Retomar</button>}
                {(c.status === 'ativa' || c.status === 'pausada') && <button type="button" disabled={act.isPending} onClick={() => act.mutate({ id: c.id, kind: 'encerrar' })} className={secondaryButton}>Encerrar</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} pageSize={15} total={total} onPage={setPage} loading={list.isFetching} />
    </div>
  )
}
