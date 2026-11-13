import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { getMonthMoney, getOverview } from '../../features/gestao/repository.ts'
import { getMyPlan } from '../../features/merchant/repository.ts'
import { formatBRL } from '../../lib/money.ts'
import { useGestao } from './context.ts'

const dateBR = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')
const pctOf = (part: number, whole: number) => `${((part / whole) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

/** Bloco com título, números e uma frase que explica. Sem gráficos, sem enfeite. */
function Block({ title, action, children, note }: { title: string; action?: { to: string; label: string }; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {action && (
          <Link to={action.to} className="pressable inline-flex min-h-10 items-center gap-1 rounded-full px-2 text-sm font-semibold text-ink hover:bg-muted">
            {action.label}<ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        )}
      </div>
      {children}
      {note && <p className="text-sm text-ink-muted">{note}</p>}
    </section>
  )
}

function Num({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className={`tabular-nums text-ink ${strong ? 'text-3xl font-bold' : 'text-2xl font-bold'}`}>{value}</dd>
    </div>
  )
}

type Situation = { text: string; tone: string }
function planSituation(charges: { kind: string; status: string; dueOn: string }[], hasPlan: boolean, source: string | null | undefined): Situation {
  const open = charges.filter((c) => c.kind === 'plano' && c.status === 'aberta').sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0]
  const today = new Date().toISOString().slice(0, 10)
  if (open && open.dueOn < today) return { text: 'Vencida — pague para não perder os recursos', tone: 'text-danger' }
  if (open) return { text: `Em aberto — vence em ${dateBR(open.dueOn)}`, tone: 'text-ink' }
  if (source === 'homologacao') return { text: 'Liberado para teste (sem cobrança)', tone: 'text-ink' }
  if (hasPlan) return { text: 'Em dia', tone: 'text-success' }
  return { text: 'Sem plano ativo', tone: 'text-ink-muted' }
}

/** Início do Tucaí Gestão: quanto vendeu, quantos pedidos, o que paga à Tucaí e o que tem a receber. */
export function OverviewTab() {
  const { business: b, plan } = useGestao()
  const base = `/painel/${b.id}`
  const o = useQuery({ queryKey: ['gestao', 'overview', b.id], queryFn: () => getOverview(b.id), refetchInterval: 60_000 })
  const month = useQuery({ queryKey: ['gestao', 'month-money', b.id], queryFn: () => getMonthMoney(b.id), refetchInterval: 120_000 })
  const billing = useQuery({ queryKey: ['merchant', 'plan', b.id], queryFn: () => getMyPlan(b.id) })
  if (o.isError) return <ErrorState error={o.error} onRetry={() => void o.refetch()} />
  const ov = o.data
  const m = month.data
  const dash = '—'
  const sub = billing.data?.subscription ?? null
  const charges = billing.data?.charges ?? []
  const sit = planSituation(charges, !!sub, plan?.source)
  const fees = m ? m.commissionCents + m.deliveryFeesCents : null

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-ink">Olá! Veja como está a sua loja</h1>
        <p className="text-sm text-ink-muted">Números de hoje e deste mês, com base nos pedidos reais.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Block title="Vendas" action={{ to: `${base}/vendas`, label: 'Ver vendas' }} note="Valor dos produtos dos pedidos entregues ou retirados.">
          <dl className="grid grid-cols-2 gap-4">
            <Num label="Hoje" value={ov ? formatBRL(ov.faturamento_hoje_cents) : dash} strong />
            <Num label="Neste mês" value={ov ? formatBRL(ov.faturamento_mes_cents) : dash} strong />
          </dl>
        </Block>

        <Block title="Pedidos de hoje" action={{ to: `${base}/pedidos`, label: 'Abrir pedidos' }}>
          <dl className="grid grid-cols-3 gap-3">
            <Num label="Recebidos" value={ov ? String(ov.recebidos_hoje) : dash} />
            <Num label="Em andamento" value={ov ? String(ov.em_andamento) : dash} />
            <Num label="Concluídos" value={ov ? String(ov.concluidos_hoje) : dash} />
          </dl>
        </Block>

        <Block title="Entregas" action={{ to: `${base}/entregas`, label: 'Ver entregas' }}
          note={m && m.deliveries > 0 ? `${m.partnerDeliveries} com entregador parceiro Tucaí e ${m.ownDeliveries} com entregador da loja.` : undefined}>
          <dl><Num label="Entregas feitas neste mês" value={m ? String(m.deliveries) : dash} /></dl>
        </Block>

        <Block title="Dinheiro das vendas" action={{ to: `${base}/relatorios`, label: 'Histórico' }}
          note="O cliente paga direto para a sua loja (ou ao entregador, que repassa para você). A Tucaí não guarda esse dinheiro, por isso não existe saque aqui.">
          <dl className="grid grid-cols-2 gap-4">
            <Num label="Recebido neste mês" value={m ? formatBRL(m.receivedCents) : dash} />
            <Num label="A receber (pedidos em andamento)" value={ov ? formatBRL(ov.pendente_cents) : dash} />
          </dl>
        </Block>

        <Block title="Mensalidade da Tucaí" action={{ to: `${base}/configuracoes`, label: 'Detalhes' }}>
          {billing.isError ? (
            <p className="text-sm text-ink-muted">Só o dono da loja vê a mensalidade.</p>
          ) : (
            <dl className="grid grid-cols-2 gap-4">
              <Num label={`Plano ${sub?.planName ?? plan?.name ?? ''}`.trim()} value={sub ? `${formatBRL(sub.priceCents)}/mês` : dash} />
              <div className="min-w-0">
                <dt className="text-sm text-ink-muted">{sub ? `Próximo vencimento: ${dateBR(sub.periodEnd)}` : 'Situação'}</dt>
                <dd className={`text-base font-semibold ${sit.tone}`}>{sit.text}</dd>
              </div>
            </dl>
          )}
        </Block>

        <Block title="Taxas da Tucaí neste mês" action={{ to: `${base}/configuracoes`, label: 'Cobranças' }}>
          <dl className="flex flex-col divide-y divide-line">
            <div className="flex items-start justify-between gap-3 py-2">
              <dt className="min-w-0 text-sm text-ink">
                <span className="font-semibold">Comissão</span>
                <span className="block text-ink-muted">
                  {!m ? '…' : m.commissionOrders === 0 ? 'Nenhum pedido teve comissão neste mês (só pedidos de valor maior pagam).'
                    : `Cobrada em ${m.commissionOrders} ${m.commissionOrders === 1 ? 'pedido' : 'pedidos'} de valor maior: cerca de ${pctOf(m.commissionCents, m.commissionBaseCents)} do valor desses pedidos.`}
                </span>
              </dt>
              <dd className="shrink-0 font-semibold tabular-nums text-ink">{m ? formatBRL(m.commissionCents) : dash}</dd>
            </div>
            <div className="flex items-start justify-between gap-3 py-2">
              <dt className="min-w-0 text-sm text-ink">
                <span className="font-semibold">Entregas</span>
                <span className="block text-ink-muted">
                  {!m ? '…' : m.deliveries === 0 ? 'Nenhuma entrega neste mês.' : [
                    m.partnerDeliveries > 0 ? `${formatBRL(Math.round(m.partnerFeesCents / m.partnerDeliveries))} por entrega × ${m.partnerDeliveries} com entregador parceiro` : null,
                    m.ownDeliveries > 0 ? `${formatBRL(Math.round(m.ownFeesCents / m.ownDeliveries))} por entrega × ${m.ownDeliveries} com entregador da loja` : null,
                  ].filter(Boolean).join('; ') + '.'}
                </span>
              </dt>
              <dd className="shrink-0 font-semibold tabular-nums text-ink">{m ? formatBRL(m.deliveryFeesCents) : dash}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 pt-2">
              <dt className="text-sm font-semibold text-ink">Total de taxas</dt>
              <dd className="font-bold tabular-nums text-ink">{fees === null ? dash : formatBRL(fees)}</dd>
            </div>
          </dl>
          {m && m.partnerCustomerFeesCents > 0 && (
            <p className="text-sm text-ink">
              Além das taxas, na cobrança entra o <strong>frete pago pelos clientes</strong> nas entregas parceiras ({formatBRL(m.partnerCustomerFeesCents)}):
              o entregador entrega esse valor à sua loja junto com o pedido, e a Tucaí usa para pagar o entregador.
            </p>
          )}
          <p className="text-sm text-ink-muted">As taxas são separadas da mensalidade e cobradas no fechamento do mês.</p>
        </Block>
      </div>
      {month.isError && <p role="status" className="text-sm text-ink-muted">Não foi possível carregar os números do mês agora.</p>}
    </div>
  )
}
