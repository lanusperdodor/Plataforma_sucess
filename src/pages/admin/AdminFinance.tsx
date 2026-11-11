import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Receipt, Wallet } from 'lucide-react'
import { useState } from 'react'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { FilterChips } from '../../components/nav/FilterChips.tsx'
import {
  cancelCharge,
  cancelSubscription,
  chargeCommission,
  chargeSubscription,
  getFinanceByPlan,
  getFinanceSeries,
  getFinanceSummary,
  listCharges,
  listFinanceBusinesses,
  listPlans,
  markChargePaid,
  setSubscription,
  type ChargeStatus,
  type FinanceBusiness,
} from '../../features/admin/repository.ts'
import { formatBRL } from '../../lib/money.ts'
import { createPaymentLink } from '../../features/payments/repository.ts'
import { FinanceReportSection } from './FinanceReport.tsx'
import { useAdminAccess } from './access-context.ts'
import { BarList, ColumnChart } from './charts.tsx'
import { AdminHeader, dangerButton, errorMessage, formatDateTime, inputClass, Panel, primaryButton, secondaryButton } from './ui.tsx'

const brl = (c: number | null | undefined) => formatBRL(Math.max(0, Math.round(c ?? 0)))
const dateBr = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')
const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const plusMonth = (iso: string) => {
  const d = new Date(iso + 'T12:00:00')
  d.setMonth(d.getMonth() + 1)
  return d.toISOString().slice(0, 10)
}
const lastMonthIso = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() - 1, 1, 12).toISOString().slice(0, 10)
}

/** Dias até o vencimento (negativo = vencido). */
export function daysUntil(iso: string | null, now = new Date()): number | null {
  if (!iso) return null
  const end = new Date(iso + 'T23:59:59')
  return Math.ceil((end.getTime() - now.getTime()) / 86_400_000) - 1
}

/** Link de WhatsApp só com dígitos (DDI 55 quando faltar). */
export function waLink(raw: string | null, text: string): string | null {
  const d = (raw ?? '').replace(/\D/g, '')
  if (d.length < 10) return null
  return `https://wa.me/${d.startsWith('55') ? d : `55${d}`}?text=${encodeURIComponent(text)}`
}

function DueBadge({ end }: { end: string | null }) {
  const days = daysUntil(end)
  if (days === null) return <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-ink-muted">Sem plano</span>
  if (days < 0) return <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">Vencido há {-days} {-days === 1 ? 'dia' : 'dias'}</span>
  if (days <= 7) return <span className="rounded-full bg-orange/15 px-2 py-0.5 text-xs font-semibold text-accent">Vence em {days === 0 ? 'hoje' : `${days} ${days === 1 ? 'dia' : 'dias'}`}</span>
  return <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">Em dia até {dateBr(end)}</span>
}

function Summary() {
  const q = useQuery({ queryKey: ['admin', 'finance', 'summary'], queryFn: getFinanceSummary })
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const s = q.data
  const cards: [string, string, string?][] = [
    ['Empresas ativas', s ? String(s.activeBusinesses) : '…'],
    ['Com plano ativo', s ? String(s.activeSubscriptions) : '…'],
    ['Receita mensal dos planos', s ? brl(s.mrrCents) : '…', 'Soma dos planos ativos'],
    ['Recebido no mês', s ? brl(s.receivedMonthCents) : '…'],
    ['Recebido no total', s ? brl(s.receivedTotalCents) : '…'],
    ['A receber', s ? brl(s.openCents) : '…', 'Cobranças em aberto'],
    ['Vencido', s ? brl(s.overdueCents) : '…', 'Em aberto com vencimento passado'],
    ['Comissão e taxas do mês', s ? brl(s.feesMonthCents) : '…', 'Pedidos concluídos (a cobrar no fechamento)'],
    ['Planos vencendo em 7 dias', s ? String(s.dueSoon) : '…'],
  ]
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {cards.map(([label, value, hint]) => (
        <Panel key={label} className="flex flex-col gap-0.5">
          <dt className="text-xs text-ink-muted">{label}</dt>
          <dd className="text-xl font-bold text-ink">{value}</dd>
          {hint && <dd className="text-xs text-ink-muted">{hint}</dd>}
        </Panel>
      ))}
    </dl>
  )
}

function BusinessRow({ b, canEdit }: { b: FinanceBusiness; canEdit: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const plans = useQuery({ queryKey: ['admin', 'plans'], queryFn: listPlans, enabled: canEdit })
  const [editing, setEditing] = useState(false)
  const [plan, setPlan] = useState(b.planCode ?? 'delivery')
  const [start, setStart] = useState(b.startedOn ?? todayIso())
  const [end, setEnd] = useState(b.periodEnd ?? plusMonth(todayIso()))
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'finance'] })
  const run = useMutation({
    mutationFn: (fn: () => Promise<void>) => fn(),
    onSuccess: () => {
      toast.success('Registrado na auditoria.')
      setEditing(false)
      refresh()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const firstName = (b.ownerName ?? '').split(' ')[0] || ''
  const message = b.periodEnd
    ? `Olá${firstName ? `, ${firstName}` : ''}! Aqui é da Tucaí. O plano ${b.planName ?? ''} de ${b.name} vence em ${dateBr(b.periodEnd)}.`
    : `Olá${firstName ? `, ${firstName}` : ''}! Aqui é da Tucaí, sobre o estabelecimento ${b.name}.`
  const wa = waLink(b.whatsapp, message)
  return (
    <Panel className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-base font-bold text-ink">{b.name}{b.status === 'suspended' && <span className="ml-2 text-xs font-normal text-danger">(suspenso)</span>}</span>
        <DueBadge end={b.periodEnd} />
      </div>
      <p className="text-ink-muted">{b.city ?? '—'} · responsável: {b.ownerName || '—'} · {b.phone ?? 'sem telefone'}</p>
      <p className="text-ink">
        Plano: <strong>{b.planName ? `${b.planName} · ${brl(b.priceCents)}/mês` : 'nenhum'}</strong>
        {b.startedOn && <> · desde {dateBr(b.startedOn)}</>}
        {b.periodEnd && <> · vence {dateBr(b.periodEnd)}</>}
      </p>
      <p className="text-ink-muted">
        Em aberto: <strong className="text-ink">{brl(b.openCents)}</strong>
        {b.overdueCents > 0 && <span className="text-danger"> (vencido {brl(b.overdueCents)})</span>} · último pagamento: {b.lastPaidAt ? formatDateTime(b.lastPaidAt) : '—'} · comissão e taxas do mês: {brl(b.feesMonthCents)}
      </p>
      <div className="flex flex-wrap gap-2">
        {wa ? (
          <a href={wa} target="_blank" rel="noopener noreferrer" className={primaryButton}><MessageCircle aria-hidden="true" className="size-4" />WhatsApp</a>
        ) : (
          <span className="inline-flex min-h-11 items-center text-xs text-ink-muted">Sem WhatsApp cadastrado</span>
        )}
        {canEdit && (
          <>
            <button type="button" onClick={() => setEditing((v) => !v)} className={secondaryButton}>{b.planCode ? 'Trocar plano' : 'Definir plano'}</button>
            {b.planCode && <button type="button" disabled={run.isPending} onClick={() => run.mutate(() => chargeSubscription(b.businessId))} className={secondaryButton}>Gerar mensalidade</button>}
            <button type="button" disabled={run.isPending} onClick={() => run.mutate(() => chargeCommission(b.businessId, lastMonthIso()))} className={secondaryButton}>Cobrar comissão do mês passado</button>
            {b.planCode && (
              <button type="button" disabled={run.isPending} onClick={() => { if (window.confirm(`Cancelar o plano de ${b.name}?`)) run.mutate(() => cancelSubscription(b.businessId)) }} className={dangerButton}>Cancelar plano</button>
            )}
          </>
        )}
      </div>
      {editing && (
        <form
          className="grid grid-cols-1 gap-2 rounded-xl border border-line p-3 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault()
            run.mutate(() => setSubscription(b.businessId, plan, start, end))
          }}
        >
          <label className="text-xs font-medium text-ink sm:col-span-2">Plano
            <select value={plan} onChange={(e) => setPlan(e.target.value)} className={inputClass}>
              {(plans.data ?? []).map((p) => <option key={p.code} value={p.code}>{p.name} · {brl(p.priceCents)}/mês</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-ink">Início<input type="date" required value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} /></label>
          <label className="text-xs font-medium text-ink">Vencimento<input type="date" required value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={inputClass} /></label>
          <button type="submit" disabled={run.isPending} className={`${primaryButton} sm:col-span-4 sm:w-fit`}>Salvar plano</button>
        </form>
      )}
    </Panel>
  )
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MONTHS_FULL = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const monthLabel = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1] ?? iso
const monthFull = (iso: string) => `${MONTHS_FULL[Number(iso.slice(5, 7)) - 1] ?? ''} de ${iso.slice(0, 4)}`
/** Eixo compacto: R$ 1,2 mil em vez de R$ 1.200,00. */
export function brlShort(cents: number): string {
  const v = cents / 100
  if (v >= 1000) return `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
  return `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
}

function Charts() {
  const series = useQuery({ queryKey: ['admin', 'finance', 'series'], queryFn: () => getFinanceSeries(12) })
  const byPlan = useQuery({ queryKey: ['admin', 'finance', 'by-plan'], queryFn: getFinanceByPlan })
  if (series.isError) return <ErrorState error={series.error} onRetry={() => void series.refetch()} />
  const months = series.data ?? []
  const fmtFull = (c: number) => brl(c)
  return (
    <section aria-label="Gráficos" className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Panel>
        <ColumnChart
          title="Recebido por mês (últimos 12 meses)"
          data={months.map((m) => ({ label: monthLabel(m.month), fullLabel: monthFull(m.month), value: m.receivedCents }))}
          format={(c) => (c === 0 ? 'R$ 0' : brlShort(c))}
          empty={series.isLoading ? 'Carregando…' : 'Nenhum pagamento recebido ainda.'}
        />
        <p className="mt-1 text-xs text-ink-muted">Cobranças marcadas como pagas, pela data do pagamento. Total no período: {fmtFull(months.reduce((s, m) => s + m.receivedCents, 0))}.</p>
      </Panel>
      <Panel>
        <ColumnChart
          title="Comissão e taxas geradas por mês"
          data={months.map((m) => ({ label: monthLabel(m.month), fullLabel: monthFull(m.month), value: m.feesCents }))}
          format={(c) => (c === 0 ? 'R$ 0' : brlShort(c))}
          empty={series.isLoading ? 'Carregando…' : 'Nenhum pedido concluído ainda.'}
        />
        <p className="mt-1 text-xs text-ink-muted">Comissão de 2% acima de R$ 50 e taxas de entrega dos pedidos concluídos (a cobrar no fechamento do mês).</p>
      </Panel>
      <Panel>
        <BarList
          title="Empresas por plano"
          data={(byPlan.data ?? []).map((p) => ({ label: p.planName, value: p.businesses }))}
          format={(n) => `${n} ${n === 1 ? 'empresa' : 'empresas'}`}
          empty={byPlan.isLoading ? 'Carregando…' : 'Nenhuma empresa ativa ainda.'}
        />
      </Panel>
      <Panel>
        <BarList
          title="Receita mensal por plano"
          data={(byPlan.data ?? []).filter((p) => p.planCode).map((p) => ({ label: p.planName, value: p.mrrCents }))}
          format={fmtFull}
          empty={byPlan.isLoading ? 'Carregando…' : 'Nenhum plano ativo ainda.'}
        />
      </Panel>
    </section>
  )
}

const STATUS_OPTIONS = [
  { value: 'aberta', label: 'Em aberto' },
  { value: 'paga', label: 'Pagas' },
  { value: 'cancelada', label: 'Canceladas' },
  { value: '', label: 'Todas' },
] as const
const KIND_LABEL = { plano: 'Mensalidade', comissao: 'Comissão', outro: 'Outro' } as const
const METHODS = [['pix', 'Pix'], ['dinheiro', 'Dinheiro'], ['transferencia', 'Transferência'], ['cartao', 'Cartão'], ['boleto', 'Boleto'], ['outro', 'Outro']] as const

function Charges({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [status, setStatus] = useState<ChargeStatus | ''>('aberta')
  const [method, setMethod] = useState('pix')
  const q = useQuery({ queryKey: ['admin', 'finance', 'charges', status], queryFn: () => listCharges(status || null) })
  const link = useMutation({
    mutationFn: createPaymentLink,
    onSuccess: (url) => {
      void navigator.clipboard?.writeText(url).then(
        () => toast.success('Link do Mercado Pago copiado. Envie para a empresa pelo WhatsApp.'),
        () => window.prompt('Copie o link de pagamento:', url),
      )
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const run = useMutation({
    mutationFn: (fn: () => Promise<void>) => fn(),
    onSuccess: () => {
      toast.success('Registrado na auditoria.')
      void qc.invalidateQueries({ queryKey: ['admin', 'finance'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <section aria-labelledby="cobrancas" className="flex flex-col gap-3">
      <h2 id="cobrancas" className="flex items-center gap-2 text-lg font-bold text-ink"><Receipt aria-hidden="true" className="size-5" />Cobranças</h2>
      <div className="flex flex-wrap items-center gap-3">
        <FilterChips label="Situação" options={STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} value={status} onChange={(v) => setStatus(v as ChargeStatus | '')} />
        {canEdit && (
          <label className="flex items-center gap-2 text-sm text-ink">Forma de pagamento
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={`${inputClass} w-auto`}>
              {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        )}
      </div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <p className="text-sm text-ink-muted">{q.isLoading ? 'Carregando…' : 'Nenhuma cobrança nesta situação.'}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(q.data ?? []).map((c) => {
            const late = c.status === 'aberta' && (daysUntil(c.dueOn) ?? 0) < 0
            return (
              <li key={c.id}>
                <Panel className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-ink">{c.businessName} · {brl(c.amountCents)}</p>
                    <p className="text-ink-muted">
                      {KIND_LABEL[c.kind]} — {c.description} · vence {dateBr(c.dueOn)}
                      {late && <span className="text-danger"> · vencida</span>}
                      {c.status === 'paga' && <> · paga em {formatDateTime(c.paidAt)} ({c.paidMethod})</>}
                      {c.status === 'cancelada' && <> · cancelada</>}
                    </p>
                  </div>
                  {canEdit && c.status === 'aberta' && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={link.isPending}
                        onClick={() => link.mutate(c.id)}
                        className={secondaryButton}
                      >
                        Link de pagamento
                      </button>
                      <button type="button" disabled={run.isPending} onClick={() => run.mutate(() => markChargePaid(c.id, method))} className={primaryButton}>Marcar como paga</button>
                      <button type="button" disabled={run.isPending} onClick={() => { if (window.confirm('Cancelar esta cobrança?')) run.mutate(() => cancelCharge(c.id)) }} className={secondaryButton}>Cancelar</button>
                    </div>
                  )}
                </Panel>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** Financeiro do Master: planos, vencimentos, recebidos, a receber e contato com as empresas. */
export function AdminFinance() {
  const access = useAdminAccess()
  const canEdit = access.isMaster && access.mfaOk
  const list = useQuery({ queryKey: ['admin', 'finance', 'businesses'], queryFn: listFinanceBusinesses })
  return (
    <div className="flex flex-col gap-6">
      <AdminHeader title="Financeiro" subtitle="Planos, vencimentos, recebimentos e contato com os estabelecimentos." />
      <Summary />
      <Charts />
      <FinanceReportSection />
      <p className="text-xs text-ink-muted">
        Gere a mensalidade e a comissão aqui. Com o Mercado Pago configurado (aba Pagamentos), envie o link de pagamento: a confirmação do provedor marca a cobrança como paga. Sem ele, receba por Pix ou outro meio e dê baixa manual.
        Pagar a mensalidade renova o plano por 1 mês. Planos aprovados: Delivery R$ 79/mês e Presencial + Delivery R$ 99/mês.
      </p>
      <section aria-labelledby="empresas" className="flex flex-col gap-3">
        <h2 id="empresas" className="flex items-center gap-2 text-lg font-bold text-ink"><Wallet aria-hidden="true" className="size-5" />Estabelecimentos e planos</h2>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : (list.data ?? []).length === 0 ? (
          <p className="text-sm text-ink-muted">{list.isLoading ? 'Carregando…' : 'Nenhum estabelecimento ativo ainda.'}</p>
        ) : (
          <ul className="flex flex-col gap-2">{(list.data ?? []).map((b) => <li key={b.businessId}><BusinessRow b={b} canEdit={canEdit} /></li>)}</ul>
        )}
      </section>
      <Charges canEdit={canEdit} />
    </div>
  )
}
