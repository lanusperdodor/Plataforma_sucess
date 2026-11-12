import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Bike, ChevronDown, ReceiptText, RotateCcw, Search, XCircle } from 'lucide-react'
import { useState } from 'react'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { FilterChips } from '../../components/nav/FilterChips.tsx'
import {
  cancelOrderAsPlatform,
  getAdminOrder,
  listAdminOrders,
  redispatchOrder,
  type AdminOrder,
  type AdminOrderScope,
} from '../../features/admin/repository.ts'
import { FULFILLMENT_LABEL, PAYMENT_LABEL, STATUS_LABEL } from '../../features/orders/repository.ts'
import { formatBRL } from '../../lib/money.ts'
import { useAdminAccess } from './access-context.ts'
import { AdminHeader, dangerButton, errorMessage, formatDateTime, inputClass, Panel, primaryButton, secondaryButton } from './ui.tsx'

const SCOPES = [
  { value: 'abertos', label: 'Em andamento' },
  { value: 'atencao', label: 'Com alerta' },
  { value: 'concluidos', label: 'Concluídos' },
  { value: 'cancelados', label: 'Recusados e cancelados' },
  { value: 'todos', label: 'Todos' },
] as const
const DELIVERY_LABEL = { offered: 'aguardando entregador', accepted: 'entregador a caminho da loja', picked_up: 'com o entregador', delivered: 'entregue', cancelled: 'cancelada' } as const
const ACTOR_LABEL: Record<string, string> = { cliente: 'Cliente', estabelecimento: 'Estabelecimento', entregador: 'Entregador', 'equipe Tucaí': 'Equipe Tucaí', sistema: 'Sistema' }

function Detail({ id, canManage }: { id: string; canManage: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['admin', 'order', id], queryFn: () => getAdminOrder(id) })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'order', id] })
    void qc.invalidateQueries({ queryKey: ['admin', 'orders'] })
  }
  const cancel = useMutation({
    mutationFn: () => {
      const reason = window.prompt('Motivo do cancelamento (cliente e estabelecimento verão):')?.trim() ?? ''
      if (!reason) return Promise.reject(new Error('Informe o motivo.'))
      return cancelOrderAsPlatform(id, reason)
    },
    onSuccess: () => { toast.success('Pedido cancelado e envolvidos avisados.'); refresh() },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const redispatch = useMutation({
    mutationFn: () => redispatchOrder(id),
    onSuccess: () => { toast.success('Entrega oferecida de novo aos entregadores.'); refresh() },
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const d = q.data
  if (!d) return <p role="status" className="text-sm text-ink-muted">Carregando…</p>
  const v = d.values
  const open = !['delivered', 'picked_up', 'rejected', 'cancelled'].includes(d.status)
  return (
    <div className="mt-3 grid gap-4 border-t border-line pt-3 text-sm md:grid-cols-2">
      <div className="flex flex-col gap-2">
        <h4 className="font-semibold text-ink">Itens</h4>
        <ul className="text-ink">
          {d.items.map((i, n) => (
            <li key={n}>{i.quantity}× {i.name}{i.options.length > 0 && <span className="text-ink-muted"> ({i.options.map((o) => o.option).join(', ')})</span>} · {formatBRL(i.line_total_cents)}</li>
          ))}
        </ul>
        {d.notes && <p className="text-ink">Observações: {d.notes}</p>}
        <h4 className="mt-2 font-semibold text-ink">Valores (calculados no servidor)</h4>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
          {([
            ['Produtos', v.subtotal_cents], ['Taxa de entrega (cliente)', v.delivery_fee_cents], ['Total do cliente', v.total_cents],
            ['Comissão Tucaí', v.commission_cents], ['Logística (estabelecimento)', v.merchant_delivery_cents],
            ['Entregador recebe', v.courier_pay_cents], ['Tarifa da plataforma', v.platform_fee_cents],
          ] as const).map(([l, c]) => (
            <div key={l} className="contents"><dt className="text-ink-muted">{l}</dt><dd className="text-right font-semibold text-ink">{formatBRL(c)}</dd></div>
          ))}
        </dl>
        <p className="text-xs text-ink-muted">Pagamento: {PAYMENT_LABEL[d.payment_method as keyof typeof PAYMENT_LABEL] ?? d.payment_method}, feito ao estabelecimento/entregador na entrega ou retirada.</p>
      </div>
      <div className="flex flex-col gap-2">
        <h4 className="font-semibold text-ink">Envolvidos</h4>
        <p className="text-ink">Cliente: {d.customer.name}{d.customer.phone ? ` · ${d.customer.phone}` : ''}</p>
        {d.customer.address && <p className="text-ink-muted">Entrega: {d.customer.address}</p>}
        <p className="text-ink">Estabelecimento: {d.business.name}{d.business.phone ? ` · ${d.business.phone}` : ''}{d.business.city ? ` · ${d.business.city}` : ''}</p>
        {d.delivery && (
          <div className="rounded-xl bg-muted p-2">
            <p className="flex items-center gap-1 font-semibold text-ink"><Bike aria-hidden="true" className="size-4" />Entrega: {DELIVERY_LABEL[d.delivery.status]}</p>
            {d.delivery.courier && <p className="text-ink">Entregador: {d.delivery.courier.name}{d.delivery.courier.phone ? ` · ${d.delivery.courier.phone}` : ''}</p>}
            {d.delivery.courier?.last_location_at && d.delivery.courier.last_lat !== null && d.delivery.courier.last_lng !== null && (
              <p className="text-ink-muted">
                Última localização compartilhada às {formatDateTime(d.delivery.courier.last_location_at)}:{' '}
                <a className="underline" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${d.delivery.courier.last_lat}&mlon=${d.delivery.courier.last_lng}#map=17/${d.delivery.courier.last_lat}/${d.delivery.courier.last_lng}`}>abrir no mapa</a>
              </p>
            )}
            <p className="text-xs text-ink-muted">Rodada {d.delivery.offer_round} · {d.delivery.declines} recusa(s){d.delivery.failed_code_attempts ? ` · ${d.delivery.failed_code_attempts} código(s) errado(s)` : ''}</p>
          </div>
        )}
        <h4 className="mt-2 font-semibold text-ink">Histórico</h4>
        <ol className="flex flex-col gap-1">
          {d.events.map((e, n) => (
            <li key={n} className="text-ink">
              <span className="text-ink-muted">{formatDateTime(e.at)}</span> · {STATUS_LABEL[e.status]} · {ACTOR_LABEL[e.actor] ?? e.actor}{e.note ? <span className="text-ink-muted"> — {e.note}</span> : null}
            </li>
          ))}
        </ol>
        {canManage && open && (
          <div className="mt-2 flex flex-wrap gap-2">
            {d.delivery && (d.delivery.status === 'offered' || d.delivery.status === 'accepted') && (
              <button type="button" disabled={redispatch.isPending} onClick={() => redispatch.mutate()} className={secondaryButton}><RotateCcw aria-hidden="true" className="size-4" />Redistribuir entrega</button>
            )}
            <button type="button" disabled={cancel.isPending} onClick={() => cancel.mutate()} className={dangerButton}><XCircle aria-hidden="true" className="size-4" />Cancelar pedido</button>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ o, canManage }: { o: AdminOrder; canManage: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <Panel className={`text-sm ${o.attention ? 'bg-warm-soft' : ''}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-2 text-left">
        <span className="font-semibold text-ink">#{o.code}</span>
        <span className="text-ink">{o.businessName}</span>
        <span className="text-ink-muted">· {o.customerName}</span>
        {o.isTest && <span className="rounded-full bg-orange/15 px-2 py-0.5 text-xs font-semibold text-accent">Teste</span>}
        <span className="ml-auto rounded-full bg-muted px-3 py-1 text-xs font-semibold text-ink">{STATUS_LABEL[o.status]}</span>
        <ChevronDown aria-hidden="true" className={`size-4 text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <p className="mt-1 text-xs text-ink-muted">
        {formatDateTime(o.createdAt)} · {FULFILLMENT_LABEL[o.fulfillment]}{o.city ? ` · ${o.city}` : ''} · {formatBRL(o.totalCents)}
        {o.deliveryStatus ? ` · entrega ${DELIVERY_LABEL[o.deliveryStatus]}` : ''}{o.courierName ? ` (${o.courierName})` : ''}
      </p>
      {o.attention && <p className="mt-1 flex items-center gap-1 font-semibold text-ink"><AlertTriangle aria-hidden="true" className="size-4 text-accent" />{o.attention}</p>}
      {open && <Detail id={o.id} canManage={canManage} />}
    </Panel>
  )
}

/** Pedidos da plataforma: acompanhamento, alertas operacionais e ocorrências. */
export function AdminOrders() {
  const access = useAdminAccess()
  const canManage = (access.isMaster && access.mfaOk) || access.permissions.includes('orders.manage')
  const [scope, setScope] = useState<AdminOrderScope>('abertos')
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [includeTest, setIncludeTest] = useState(true)
  const [page, setPage] = useState(0)
  const size = 30
  const q = useQuery({
    queryKey: ['admin', 'orders', scope, term, includeTest, page],
    queryFn: () => listAdminOrders(scope, term, includeTest, size, page * size),
    refetchInterval: scope === 'abertos' || scope === 'atencao' ? 30_000 : false,
  })
  const rows = q.data ?? []
  const total = rows[0]?.total ?? 0
  return (
    <div className="flex flex-col gap-6">
      <AdminHeader title="Pedidos" subtitle="Acompanhe a operação, veja quem fez cada passo e trate ocorrências." />
      <Panel className="flex flex-col gap-3">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setPage(0); setTerm(search) }}>
          <label className="min-w-56 flex-1 text-sm font-medium text-ink">
            Buscar por código, estabelecimento ou cliente
            <span className="relative block">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputClass} pl-9`} />
            </span>
          </label>
          <button type="submit" className={primaryButton}>Buscar</button>
        </form>
        <FilterChips label="Situação" options={SCOPES.map((s) => ({ value: s.value, label: s.label }))} value={scope} onChange={(v) => { setPage(0); setScope(v as AdminOrderScope) }} />
        <label className="inline-flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={includeTest} onChange={(e) => { setPage(0); setIncludeTest(e.target.checked) }} className="size-4" />
          Incluir pedidos de teste
        </label>
        <p className="text-xs text-ink-muted">
          Alertas: pedido sem aceite há mais de 10 min, entrega sem entregador após as rodadas de oferta, entregador sem coletar em 40 min, preparo atrasado e retirada pendente há mais de 1 h.
          {canManage ? ' Cancelar e redistribuir ficam registrados na Auditoria.' : ' Cancelar e redistribuir exigem a permissão “Tratar ocorrências de pedidos”.'}
        </p>
      </Panel>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <Panel className="flex items-center gap-2 text-sm text-ink-muted"><ReceiptText aria-hidden="true" className="size-5" />{q.isLoading ? 'Carregando…' : 'Nenhum pedido nesta situação.'}</Panel>
      ) : (
        <>
          <p className="text-sm text-ink-muted" aria-live="polite">{total} {total === 1 ? 'pedido' : 'pedidos'}</p>
          <ul className="flex flex-col gap-2">{rows.map((o) => <li key={o.id}><Row o={o} canManage={canManage} /></li>)}</ul>
          {total > size && (
            <div className="flex items-center gap-2">
              <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className={secondaryButton}>Anterior</button>
              <span className="text-sm text-ink-muted">Página {page + 1} de {Math.ceil(total / size)}</span>
              <button type="button" disabled={(page + 1) * size >= total} onClick={() => setPage((p) => p + 1)} className={secondaryButton}>Próxima</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
