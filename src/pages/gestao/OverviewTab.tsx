import { useQuery } from '@tanstack/react-query'
import { ChefHat, ReceiptText, UtensilsCrossed, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { getOverview, type Overview } from '../../features/gestao/repository.ts'
import { formatBRL } from '../../lib/money.ts'
import { useGestao } from './context.ts'
import { box, money, SectionTitle, Stat } from './ui.tsx'

const dayLabel = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7)

/** Faturamento dos últimos 14 dias: uma série, barras finas, valor ao passar o mouse/foco e tabela para leitores de tela. */
function SalesChart({ serie }: { serie: Overview['serie'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...serie.map((d) => d.cents))
  const total = serie.reduce((s, d) => s + d.cents, 0)
  const sel = hover !== null ? serie[hover] : undefined
  return (
    <section className={box} aria-labelledby="fat14">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="fat14" className="text-base font-semibold text-ink">Faturamento — últimos 14 dias</h2>
        <p className="text-sm tabular-nums text-ink-muted" aria-live="polite">
          {sel ? <><strong className="text-ink">{formatBRL(sel.cents)}</strong> em {dayLabel(sel.dia)}</> : <>Total {formatBRL(total)}</>}
        </p>
      </div>
      {total === 0 ? (
        <p className="text-sm text-ink-muted">Ainda não há pedidos concluídos neste período.</p>
      ) : (
        <div aria-hidden="true" className="flex h-36 items-end gap-[2px] border-b border-line" onMouseLeave={() => setHover(null)}>
          {serie.map((d, i) => (
            <div key={d.dia} className="flex h-full flex-1 cursor-default items-end" onMouseEnter={() => setHover(i)}>
              <div
                className={`w-full rounded-t-[4px] ${hover === i ? 'bg-ink' : 'bg-brand'}`}
                style={{ height: `${d.cents ? Math.max(3, (d.cents / max) * 100) : 0}%` }}
              />
            </div>
          ))}
        </div>
      )}
      {total > 0 && (
        <div aria-hidden="true" className="mt-1 flex justify-between text-[11px] text-ink-muted">
          <span>{dayLabel(serie[0]!.dia)}</span><span>{dayLabel(serie[serie.length - 1]!.dia)}</span>
        </div>
      )}
      <table className="sr-only">
        <caption>Faturamento por dia</caption>
        <thead><tr><th>Dia</th><th>Valor</th></tr></thead>
        <tbody>{serie.map((d) => <tr key={d.dia}><td>{dayLabel(d.dia)}</td><td>{formatBRL(d.cents)}</td></tr>)}</tbody>
      </table>
    </section>
  )
}

export function OverviewTab() {
  const { business: b, niche, premium, can } = useGestao()
  const q = useQuery({ queryKey: ['gestao', 'overview', b.id], queryFn: () => getOverview(b.id), refetchInterval: 60_000 })
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const o = q.data
  const shortcuts = [
    { to: 'pedidos', label: 'Pedidos recebidos', icon: ReceiptText, show: can('orders.view') },
    { to: 'cozinha', label: niche === 'mercadinho' ? 'Separação' : 'Cozinha', icon: ChefHat, show: niche === 'restaurante' || niche === 'mercadinho' },
    { to: 'mesas', label: niche === 'restaurante' ? 'Comandas e mesas' : 'Comandas de balcão', icon: UtensilsCrossed, show: premium && can('tabs.manage') && (niche === 'restaurante' || niche === 'mercadinho') },
    { to: 'caixa', label: 'Caixa', icon: Wallet, show: premium && can('cash.manage') && niche !== 'servico' },
  ].filter((s) => s.show)
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle title="Visão geral" subtitle="Resumo de hoje e do mês, calculado no servidor a partir dos pedidos reais." />
      {!o ? (
        <p role="status" className="text-sm text-ink-muted">Carregando…</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Pedidos recebidos hoje" value={String(o.recebidos_hoje)} />
            <Stat label="Em andamento" value={String(o.em_andamento)} hint={o.pendente_cents ? `${formatBRL(o.pendente_cents)} a receber` : undefined} />
            <Stat label="Concluídos hoje" value={String(o.concluidos_hoje)} />
            <Stat label="Cancelados/recusados hoje" value={String(o.cancelados_hoje)} />
            <Stat label="Faturamento hoje" value={formatBRL(o.faturamento_hoje_cents)} />
            <Stat label="Faturamento no mês" value={formatBRL(o.faturamento_mes_cents)} />
            <Stat label="Ticket médio (mês)" value={formatBRL(o.ticket_medio_cents)} />
            <Stat label="Taxas Tucaí (mês)" value={formatBRL(o.taxas_mes_cents)} />
            {o.despesas_mes_cents !== null && <Stat label="Gastos lançados (mês)" value={formatBRL(o.despesas_mes_cents)} />}
            {o.despesas_mes_cents !== null && (
              <Stat label="Resultado estimado (mês)" value={money(o.faturamento_mes_cents - o.taxas_mes_cents - o.despesas_mes_cents)} hint="Faturamento − taxas − gastos" />
            )}
          </dl>
          <SalesChart serie={o.serie} />
        </>
      )}
      {shortcuts.length > 0 && (
        <nav aria-label="Atalhos" className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {shortcuts.map((s) => (
            <Link key={s.to} to={`/painel/${b.id}/${s.to}`} className="hover-lift pressable flex min-h-16 items-center gap-3 rounded-card border border-line bg-surface p-3 text-sm font-semibold text-ink">
              <s.icon aria-hidden="true" className="size-5 text-ink-muted" />{s.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  )
}
