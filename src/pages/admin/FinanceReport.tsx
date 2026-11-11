import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Download, FileBarChart } from 'lucide-react'
import { useState } from 'react'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { financeReport, financeTransactions, listCities, listFinanceBusinesses, type FinanceFilters, type FinanceTx } from '../../features/admin/repository.ts'
import { formatBRL } from '../../lib/money.ts'
import { errorMessage, formatDateTime, inputClass, Pager, Panel, primaryButton, secondaryButton } from './ui.tsx'

const iso = (d: Date) => d.toISOString().slice(0, 10)
const STATUS: Record<string, string> = {
  placed: 'Recebido', accepted: 'Aceito', preparing: 'Em preparo', ready: 'Pronto', out_for_delivery: 'Em entrega', delivered: 'Entregue',
  picked_up: 'Retirado', rejected: 'Recusado', cancelled: 'Cancelado', aberta: 'Em aberto', paga: 'Paga', cancelada: 'Cancelada',
}

/** CSV com ; (abre direto no Excel em pt-BR) e valores em reais. */
export function toCsv(rows: FinanceTx[]): string {
  const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const money = (c: number) => (c / 100).toFixed(2).replace('.', ',')
  const head = ['Tipo', 'Referência', 'Data', 'Estabelecimento', 'Cidade', 'Descrição', 'Situação', 'Valor (R$)', 'Plataforma (R$)', 'Entregador (R$)', 'Forma']
  const lines = rows.map((r) => [r.kind === 'pedido' ? 'Pedido' : 'Cobrança', r.ref, formatDateTime(r.at), r.business, r.city ?? '', r.description, STATUS[r.status] ?? r.status,
    money(r.amountCents), money(r.platformCents), money(r.courierCents), r.method ?? ''].map((v) => esc(String(v))).join(';'))
  return '﻿' + [head.join(';'), ...lines].join('\r\n')
}

function Box({ title, items, note }: { title: string; items: [string, number | string][]; note?: string }) {
  return (
    <Panel className="flex flex-col gap-2 text-sm">
      <h3 className="font-bold text-ink">{title}</h3>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
        {items.map(([l, v]) => (
          <div key={l} className="contents"><dt className="text-ink-muted">{l}</dt><dd className="text-right font-semibold tabular-nums text-ink">{typeof v === 'number' ? formatBRL(v) : v}</dd></div>
        ))}
      </dl>
      {note && <p className="text-xs text-ink-muted">{note}</p>}
    </Panel>
  )
}

/** Relatório financeiro por período, cidade e estabelecimento: previsto, confirmado, recebido e repassado; histórico exportável. */
export function FinanceReportSection() {
  const toast = useToast()
  const today = new Date()
  const initial: FinanceFilters = { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today), city: '', business: '', includeTest: false }
  const [draft, setDraft] = useState(initial)
  const [f, setF] = useState(initial)
  const [kind, setKind] = useState<'todos' | 'pedido' | 'cobranca'>('todos')
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)
  const cities = useQuery({ queryKey: ['admin', 'cities'], queryFn: listCities, staleTime: 300_000 })
  const businesses = useQuery({ queryKey: ['admin', 'finance', 'businesses'], queryFn: listFinanceBusinesses, staleTime: 300_000 })
  const r = useQuery({ queryKey: ['admin', 'finance', 'report', f], queryFn: () => financeReport(f) })
  const tx = useQuery({ queryKey: ['admin', 'finance', 'tx', f, kind, page], queryFn: () => financeTransactions(f, kind, page), placeholderData: keepPreviousData })

  const exportCsv = async () => {
    setExporting(true)
    try {
      const all: FinanceTx[] = []
      for (let p = 1; p <= 50; p++) {
        const chunk = await financeTransactions(f, kind, p)
        all.push(...chunk)
        if (chunk.length < 100 || all.length >= (chunk[0]?.total ?? 0)) break
      }
      const blob = new Blob([toCsv(all)], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `tucai-financeiro-${f.from}-a-${f.to}.csv`
      a.click()
      URL.revokeObjectURL(a.href)
      toast.success(`${all.length} lançamento(s) exportado(s).`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  const d = r.data
  const rows = tx.data ?? []
  return (
    <section aria-labelledby="relatorio" className="flex flex-col gap-3">
      <h2 id="relatorio" className="flex items-center gap-2 text-lg font-bold text-ink"><FileBarChart aria-hidden="true" className="size-5" />Relatório do período</h2>
      <form className="grid gap-2 rounded-card border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-6" onSubmit={(e) => { e.preventDefault(); setPage(1); setF(draft) }}>
        <label className="text-sm font-medium text-ink">De<input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} className={inputClass} /></label>
        <label className="text-sm font-medium text-ink">Até<input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} className={inputClass} /></label>
        <label className="text-sm font-medium text-ink">Cidade
          <select value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} className={inputClass}>
            <option value="">Todas</option>
            {(cities.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} - {c.state}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-ink">Estabelecimento
          <select value={draft.business} onChange={(e) => setDraft({ ...draft, business: e.target.value })} className={inputClass}>
            <option value="">Todos</option>
            {(businesses.data ?? []).map((b) => <option key={b.businessId} value={b.businessId}>{b.name}</option>)}
          </select>
        </label>
        <label className="flex items-end gap-2 pb-3 text-sm text-ink"><input type="checkbox" className="size-4" checked={draft.includeTest} onChange={(e) => setDraft({ ...draft, includeTest: e.target.checked })} />Incluir teste</label>
        <div className="flex items-end"><button type="submit" className={primaryButton}>Aplicar</button></div>
      </form>
      {r.isError ? (
        <ErrorState error={r.error} onRetry={() => void r.refetch()} />
      ) : !d ? (
        <p role="status" className="text-sm text-ink-muted">Carregando…</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Box title="Confirmado (pedidos entregues/retirados)" items={[
            ['Pedidos', String(d.confirmado.pedidos)], ['Volume bruto (cliente)', d.confirmado.volume_bruto_cents], ['Produtos', d.confirmado.produtos_cents],
            ['Comissões', d.confirmado.comissao_cents], ['Taxas da plataforma', d.confirmado.taxas_plataforma_cents],
            ['Receita da plataforma', d.confirmado.comissao_cents + d.confirmado.taxas_plataforma_cents],
          ]} note="Pagos pelo cliente ao estabelecimento/entregador na entrega; a parte da Tucaí é cobrada do estabelecimento." />
          <Box title="Previsto (pedidos em andamento)" items={[
            ['Pedidos', String(d.previsto.pedidos)], ['Volume bruto', d.previsto.volume_bruto_cents],
            ['Comissões previstas', d.previsto.comissao_cents], ['Taxas previstas', d.previsto.taxas_plataforma_cents],
          ]} />
          <Box title="Recebido pela Tucaí (cobranças)" items={[
            ['Recebido no período', d.mensalidades.recebido_cents], ['…pelo Mercado Pago', d.mensalidades.recebido_online_cents],
            ['A receber (em aberto)', d.mensalidades.a_receber_cents], ['Vencido', d.mensalidades.vencido_cents],
          ]} note="Mensalidades e comissões cobradas. Só conta como recebido o que foi confirmado (Mercado Pago ou baixa manual registrada)." />
          <Box title="Entregadores" items={[
            ['Devido (entregas concluídas)', d.confirmado.devido_entregadores_cents],
            ['Repassado', d.repassado.registrado ? d.repassado.entregadores_cents : 'sem registro'],
          ]} note="Ainda não há módulo de repasse: o valor devido vem das entregas concluídas; nenhum repasse é inventado." />
          <Box title="Cancelamentos e reembolsos" items={[
            ['Pedidos recusados/cancelados', String(d.cancelados.pedidos)], ['Valor não realizado', d.cancelados.volume_cents],
            ['Reembolsos', d.reembolsos.registrado ? d.reembolsos.cents : 'sem integração'],
          ]} note="Pedidos são pagos na entrega: cancelamento não gera cobrança. Estornos do Mercado Pago ainda não são recebidos pela Tucaí." />
          <Box title="Por cidade" items={d.por_cidade.length ? d.por_cidade.map((c) => [`${c.cidade} (${c.pedidos})`, c.volume_cents] as [string, number]) : [['Sem pedidos concluídos', '—']]} />
        </div>
      )}
      <Panel className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-ink">Histórico de transações</h3>
          <div className="flex flex-wrap gap-2">
            <select aria-label="Tipo de lançamento" value={kind} onChange={(e) => { setPage(1); setKind(e.target.value as typeof kind) }} className={`${inputClass} w-auto`}>
              <option value="todos">Pedidos e cobranças</option><option value="pedido">Só pedidos</option><option value="cobranca">Só cobranças</option>
            </select>
            <button type="button" disabled={exporting || rows.length === 0} onClick={() => void exportCsv()} className={secondaryButton}>
              <Download aria-hidden="true" className="size-4" />{exporting ? 'Exportando…' : 'Exportar CSV'}
            </button>
          </div>
        </div>
        {tx.isError ? <ErrorState error={tx.error} onRetry={() => void tx.refetch()} /> : rows.length === 0 ? (
          <p className="text-ink-muted">{tx.isLoading ? 'Carregando…' : 'Nenhum lançamento no período.'}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-left">
                <thead className="text-xs text-ink-muted"><tr><th className="py-1">Data</th><th>Lançamento</th><th>Estabelecimento</th><th>Situação</th><th className="text-right">Valor</th><th className="text-right">Plataforma</th><th className="text-right">Entregador</th></tr></thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={`${t.kind}-${t.ref}`} className="border-t border-line">
                      <td className="py-1.5 text-ink-muted">{formatDateTime(t.at)}</td>
                      <td className="text-ink">{t.kind === 'pedido' ? `#${t.ref}` : 'Cobrança'} · {t.description}</td>
                      <td className="text-ink">{t.business}</td>
                      <td className="text-ink">{STATUS[t.status] ?? t.status}</td>
                      <td className="text-right tabular-nums text-ink">{formatBRL(t.amountCents)}</td>
                      <td className="text-right tabular-nums text-ink">{formatBRL(t.platformCents)}</td>
                      <td className="text-right tabular-nums text-ink">{formatBRL(t.courierCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={100} total={rows[0]?.total ?? 0} onPage={setPage} loading={tx.isFetching} />
          </>
        )}
      </Panel>
    </section>
  )
}
