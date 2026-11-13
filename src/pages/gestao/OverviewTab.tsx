import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight, Calculator, CalendarDays, CheckCircle2, Crown, LayoutGrid, ListChecks, Percent, PiggyBank, Receipt, ReceiptText, ShoppingBag, Timer,
  TrendingUp, Wallet, XCircle, type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { getCashStatus, getOverview, type Overview } from '../../features/gestao/repository.ts'
import { formatBRL } from '../../lib/money.ts'
import { useGestao } from './context.ts'
import { gestaoNav, NAV_GROUPS } from './nav.ts'
import { box, money, SectionTitle } from './ui.tsx'

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
                className={`w-full rounded-t-[4px] ${hover === i ? 'bg-ink' : 'bg-orange'}`}
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

type Tone = 'blue' | 'orange' | 'green' | 'violet' | 'teal' | 'amber' | 'rose'
const TONE: Record<Tone, { chip: string; bar: string }> = {
  blue: { chip: 'bg-muted text-ink', bar: '' },
  orange: { chip: 'bg-muted text-ink', bar: '' },
  green: { chip: 'bg-muted text-ink', bar: '' },
  violet: { chip: 'bg-muted text-ink', bar: '' },
  teal: { chip: 'bg-muted text-ink', bar: '' },
  amber: { chip: 'bg-muted text-ink', bar: '' },
  rose: { chip: 'bg-muted text-ink', bar: '' },
}

/** Indicador com ícone colorido. O número fica na cor do texto; a cor só identifica o tipo. */
function Tile({ label, value, hint, icon: Icon, tone }: { label: string; value: string; hint?: string; icon: LucideIcon; tone: Tone }) {
  const t = TONE[tone]
  return (
    <div className="relative overflow-hidden rounded-card border border-line bg-surface p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <dt className="text-xs font-medium text-ink-muted sm:text-sm">{label}</dt>
        <span aria-hidden="true" className={`grid size-8 shrink-0 place-items-center rounded-lg ${t.chip}`}><Icon className="size-4" /></span>
      </div>
      <dd className="mt-1 text-xl font-bold tabular-nums text-ink sm:text-2xl">{value}</dd>
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  )
}

interface Step { key: string; text: string; detail: string; to: string; action: string; tone: Tone; icon: LucideIcon }

export function OverviewTab() {
  const { business: b, niche, premium, can } = useGestao()
  const q = useQuery({ queryKey: ['gestao', 'overview', b.id], queryFn: () => getOverview(b.id), refetchInterval: 60_000 })
  const cash = useQuery({
    queryKey: ['gestao', 'cash-status', b.id], queryFn: () => getCashStatus(b.id), refetchInterval: 60_000,
    enabled: premium && can('cash.manage') && niche !== 'servico',
  })
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const o = q.data
  const nav = gestaoNav(niche).filter((i) => i.to !== '' && can(i.permission))
  const base = `/painel/${b.id}`

  // Próximos passos: só o que faz sentido agora, em ordem de urgência
  const steps: Step[] = []
  if (o && o.em_andamento > 0 && can('orders.view')) {
    steps.push({ key: 'pedidos', text: `${o.em_andamento} ${o.em_andamento === 1 ? 'pedido em andamento' : 'pedidos em andamento'}`, detail: 'Confira, aceite e atualize o status.', to: 'pedidos', action: 'Ver pedidos', tone: 'orange', icon: ReceiptText })
  }
  if (cash.data && !cash.data.open) {
    steps.push({ key: 'caixa', text: 'O caixa está fechado', detail: 'Abra o caixa para registrar vendas no balcão.', to: 'caixa', action: 'Abrir caixa', tone: 'orange', icon: Wallet })
  }
  if (premium && can('reports.view')) {
    steps.push({ key: 'calc', text: 'Seu preço está bom?', detail: 'Use a calculadora para ver se cada produto cobre os custos e dá lucro.', to: 'calculadora', action: 'Calcular', tone: 'green', icon: Calculator })
    if (o && o.despesas_mes_cents === 0) {
      steps.push({ key: 'gastos', text: 'Nenhum gasto lançado este mês', detail: 'Lance aluguel, contas e compras para ver o lucro real.', to: 'gastos', action: 'Lançar gastos', tone: 'green', icon: Receipt })
    }
  }
  if (can('menu.manage') && o && o.faturamento_mes_cents === 0) {
    steps.push({ key: 'cardapio', text: 'Revise produtos e preços', detail: 'Um cardápio completo, com fotos, vende mais.', to: 'cardapio', action: 'Abrir', tone: 'violet', icon: LayoutGrid })
  }
  if (!premium && can('reports.view')) {
    steps.push({ key: 'plano', text: 'Libere caixa, comandas, gastos, lucro e calculadora', detail: 'Módulos do plano Premium.', to: 'configuracoes', action: 'Ver planos', tone: 'amber', icon: Crown })
  }

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <SectionTitle title="Visão geral" subtitle="Resumo de hoje e do mês, calculado no servidor a partir dos pedidos reais." />
      {steps.length > 0 && (
        <section aria-labelledby="proximos" className="rounded-card border border-line bg-surface p-4">
          <h2 id="proximos" className="mb-3 flex items-center gap-2 text-base font-semibold text-ink">
            <ListChecks aria-hidden="true" className="size-5 text-ink-muted" />
            O que fazer agora
          </h2>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
            {steps.slice(0, 6).map((s) => (
              <li key={s.key} className="flex flex-wrap items-center gap-3 rounded-xl bg-muted p-3">
                <span aria-hidden="true" className={`grid size-10 shrink-0 place-items-center rounded-xl ${TONE[s.tone].chip}`}><s.icon className="size-5" /></span>
                <div className="min-w-[10rem] flex-1">
                  <p className="text-sm font-semibold text-ink">{s.text}</p>
                  <p className="text-xs text-ink-muted">{s.detail}</p>
                </div>
                <Link to={`${base}/${s.to}`} className="pressable ml-auto inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full bg-surface px-3 text-sm font-semibold text-ink hover:bg-line/40">
                  {s.action}<ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!o ? (
        <p role="status" className="text-sm text-ink-muted">Carregando…</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4 3xl:grid-cols-5">
            <Tile label="Pedidos hoje" value={String(o.recebidos_hoje)} icon={ReceiptText} tone="blue" />
            <Tile label="Em andamento" value={String(o.em_andamento)} hint={o.pendente_cents ? `${formatBRL(o.pendente_cents)} a receber` : undefined} icon={Timer} tone="orange" />
            <Tile label="Concluídos hoje" value={String(o.concluidos_hoje)} icon={CheckCircle2} tone="teal" />
            <Tile label="Cancelados/recusados hoje" value={String(o.cancelados_hoje)} icon={XCircle} tone="rose" />
            <Tile label="Faturamento hoje" value={formatBRL(o.faturamento_hoje_cents)} icon={TrendingUp} tone="green" />
            <Tile label="Faturamento no mês" value={formatBRL(o.faturamento_mes_cents)} icon={CalendarDays} tone="green" />
            <Tile label="Ticket médio (mês)" value={formatBRL(o.ticket_medio_cents)} icon={ShoppingBag} tone="violet" />
            <Tile label="Taxas Tucaí (mês)" value={formatBRL(o.taxas_mes_cents)} icon={Percent} tone="amber" />
            {o.despesas_mes_cents !== null && <Tile label="Gastos lançados (mês)" value={formatBRL(o.despesas_mes_cents)} icon={Receipt} tone="rose" />}
            {o.despesas_mes_cents !== null && (
              <Tile label="Resultado estimado (mês)" value={money(o.faturamento_mes_cents - o.taxas_mes_cents - o.despesas_mes_cents)} hint="Faturamento − taxas − gastos" icon={PiggyBank} tone="green" />
            )}
          </dl>
          <SalesChart serie={o.serie} />
        </>
      )}
      {nav.length > 0 && (
        <nav aria-label="Atalhos" className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-ink">Atalhos</h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6">
            {nav.map((i) => {
              const g = NAV_GROUPS[i.group]
              return (
                <li key={`${i.to}-${i.label}`}>
                  <Link to={`${base}/${i.to}`} className="hover-lift pressable flex h-full min-h-16 items-center gap-3 rounded-card border border-line bg-surface p-3">
                    <span aria-hidden="true" className={`grid size-10 shrink-0 place-items-center rounded-xl ${g.chip}`}><i.icon className="size-5" /></span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{i.label}</span>
                      <span className="block truncate text-xs text-ink-muted">{i.hint}</span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      )}
    </div>
  )
}
