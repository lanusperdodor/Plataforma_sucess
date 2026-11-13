import { useQuery } from '@tanstack/react-query'
import { Bike, Percent, Receipt, Wallet } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { financeReport, getDeliveryMoney } from '../../features/admin/repository.ts'
import { formatBRL } from '../../lib/money.ts'

type Period = 'hoje' | 'mes' | 'mes_passado' | 'ano'
const PERIODS: { id: Period; label: string }[] = [
  { id: 'hoje', label: 'Hoje' },
  { id: 'mes', label: 'Este mês' },
  { id: 'mes_passado', label: 'Mês passado' },
  { id: 'ano', label: 'Este ano' },
]
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)

/** Intervalo [de, até] de cada período, em datas locais. */
export function periodRange(p: Period, now = new Date()): { from: string; to: string } {
  const y = now.getFullYear(), m = now.getMonth()
  if (p === 'hoje') return { from: iso(now), to: iso(now) }
  if (p === 'mes') return { from: iso(new Date(y, m, 1)), to: iso(now) }
  if (p === 'mes_passado') return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) }
  return { from: iso(new Date(y, 0, 1)), to: iso(now) }
}

function Line({ icon: Icon, label, hint, value }: { icon: typeof Bike; label: string; hint: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-ink"><Icon className="size-4" /></span>
        <div className="min-w-0">
          <p className="font-semibold text-ink">{label}</p>
          <p className="text-sm text-ink-muted">{hint}</p>
        </div>
      </div>
      <p className="shrink-0 text-lg font-bold tabular-nums text-ink">{value}</p>
    </div>
  )
}

function Big({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="text-3xl font-bold tabular-nums text-ink sm:text-4xl">{value}</p>
      {note && <p className="mt-1 text-sm text-ink-muted">{note}</p>}
    </div>
  )
}

/** Resumo do Financeiro do Master: quanto a Tucaí ganhou só com entregas e no total, por período. */
export function FinanceOverview() {
  const [period, setPeriod] = useState<Period>('mes')
  const [includeTest, setIncludeTest] = useState(true)
  const range = periodRange(period)
  const filters = { ...range, city: '', business: '', includeTest }
  const r = useQuery({ queryKey: ['admin', 'finance', 'overview', filters], queryFn: () => financeReport(filters) })
  // quantidade de entregas (0036); sem ela o resumo funciona igual, só sem a contagem
  const counts = useQuery({ queryKey: ['admin', 'delivery-money', range.from, range.to, includeTest], queryFn: () => getDeliveryMoney(range.from, range.to, includeTest), retry: false })
  const d = r.data
  const delivery = d?.confirmado.taxas_plataforma_cents ?? 0
  const commission = d?.confirmado.comissao_cents ?? 0
  const plans = d?.mensalidades.recebido_cents ?? 0
  const total = delivery + commission + plans
  const n = counts.data ? counts.data.entregas_parceiras + counts.data.entregas_proprias : null
  const v = (c: number) => (d ? formatBRL(c) : '…')

  return (
    <section aria-labelledby="ganhos" className="flex flex-col gap-4">
      <h2 id="ganhos" className="sr-only">Resumo dos ganhos</h2>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label="Período" className="grid grid-cols-2 gap-2 sm:flex">
          {PERIODS.map((p) => (
            <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}
              className={`pressable min-h-11 rounded-full px-4 text-sm font-semibold ${period === p.id ? 'bg-brand text-surface' : 'border border-line bg-surface text-ink'}`}>
              {p.label}
            </button>
          ))}
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
          <input type="checkbox" className="size-4" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />Incluir pedidos de teste
        </label>
      </div>

      {r.isError ? <ErrorState error={r.error} onRetry={() => void r.refetch()} /> : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Big label="Ganhei só com entregas" value={v(delivery)}
              note={n === null ? 'Taxa da Tucaí por entrega concluída.' : `${n} ${n === 1 ? 'entrega concluída' : 'entregas concluídas'} · taxa da Tucaí por entrega.`} />
            <Big label="Ganhei no total" value={v(total)} note="Entregas + comissões + mensalidades recebidas." />
          </div>

          <div className="rounded-card border border-line bg-surface px-4 sm:px-5">
            <div className="divide-y divide-line">
              <Line icon={Bike} label="Entregas" hint="Taxa da Tucaí em cada entrega concluída (entregador parceiro ou da loja)." value={v(delivery)} />
              <Line icon={Percent} label="Comissões" hint="Percentual sobre os pedidos de valor maior." value={v(commission)} />
              <Line icon={Receipt} label="Mensalidades recebidas" hint="Planos pagos pelos estabelecimentos neste período." value={v(plans)} />
              <div className="flex items-center justify-between gap-3 py-3">
                <p className="font-bold text-ink">Total</p>
                <p className="text-xl font-bold tabular-nums text-ink">{v(total)}</p>
              </div>
            </div>
          </div>

          {d && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-card border border-line bg-surface p-4 text-sm">
                <p className="flex items-center gap-2 font-semibold text-ink"><Wallet aria-hidden="true" className="size-4" />Ainda vai entrar</p>
                <p className="mt-1 text-ink-muted">Pedidos em andamento: {formatBRL(d.previsto.taxas_plataforma_cents)} de entregas e {formatBRL(d.previsto.comissao_cents)} de comissões.</p>
                <p className="text-ink-muted">Mensalidades em aberto: {formatBRL(d.mensalidades.a_receber_cents)}{d.mensalidades.vencido_cents > 0 ? ` (${formatBRL(d.mensalidades.vencido_cents)} vencidas)` : ''}.</p>
              </div>
              <div className="rounded-card border border-line bg-surface p-4 text-sm text-ink-muted">
                Entregas e comissões são cobradas dos estabelecimentos no fechamento do mês (sub-aba Mensalidades e cobranças).
                Os pedidos de teste só entram quando a opção acima está marcada.
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
