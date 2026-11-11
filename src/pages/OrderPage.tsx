import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bike, Check, KeyRound, MessageCircle, ReceiptText, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../components/feedback/EmptyState.tsx'
import { ErrorState } from '../components/feedback/ErrorState.tsx'
import { useToast } from '../components/feedback/toast-context.ts'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import { VEHICLE_LABEL, type Vehicle } from '../features/courier/repository.ts'
import {
  FULFILLMENT_LABEL,
  PAYMENT_LABEL,
  STATUS_LABEL,
  getMyDelivery,
  getMyOrderReview,
  getOrder,
  isFinal,
  submitReview,
  updateOrderStatus,
  type Fulfillment,
  type OrderStatus,
} from '../features/orders/repository.ts'
import { formatBRL } from '../lib/money.ts'
import { trackPurchase } from '../features/tracking/tracker.ts'
import { whatsappHref } from './BusinessPage.tsx'
import { dateTime } from './OrdersPage.tsx'

/** Etapas esperadas por modalidade (a linha do tempo marca as já registradas no histórico). */
export function expectedSteps(f: Fulfillment): OrderStatus[] {
  if (f === 'pickup') return ['placed', 'accepted', 'preparing', 'ready', 'picked_up']
  return ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered']
}

const box = 'rounded-card border border-line bg-surface p-4'

function ReviewBox({ orderId }: { orderId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const mine = useQuery({ queryKey: ['orders', 'review', orderId], queryFn: () => getMyOrderReview(orderId) })
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const send = useMutation({
    mutationFn: () => submitReview(orderId, rating, comment),
    onSuccess: () => {
      toast.success('Obrigado pela avaliação!')
      void qc.invalidateQueries({ queryKey: ['orders', 'review', orderId] })
      void qc.invalidateQueries({ queryKey: ['store'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível enviar.'),
  })
  if (mine.isLoading) return null
  if (mine.data) {
    return (
      <section aria-labelledby="av" className={box}>
        <h2 id="av" className="mb-1 text-base font-semibold text-ink">Sua avaliação</h2>
        <p className="text-ink">{'★'.repeat(mine.data.rating)}<span className="sr-only">{mine.data.rating} de 5</span></p>
        {mine.data.comment && <p className="text-sm text-ink">{mine.data.comment}</p>}
        {mine.data.reply && <p className="mt-2 border-l-2 border-brand pl-2 text-sm text-ink"><span className="font-semibold">Resposta:</span> {mine.data.reply}</p>}
      </section>
    )
  }
  return (
    <form
      aria-labelledby="av"
      className={`${box} flex flex-col gap-3`}
      onSubmit={(e) => {
        e.preventDefault()
        if (rating > 0) send.mutate()
      }}
    >
      <h2 id="av" className="text-base font-semibold text-ink">Avalie o pedido</h2>
      <div role="radiogroup" aria-label="Nota" className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} ${n === 1 ? 'estrela' : 'estrelas'}`} onClick={() => setRating(n)} className="pressable inline-flex size-11 items-center justify-center">
            <Star aria-hidden="true" className={`size-7 ${n <= rating ? 'fill-warm text-warm' : 'text-line'}`} />
          </button>
        ))}
      </div>
      <label htmlFor="av-c" className="text-sm font-medium text-ink">Comentário (opcional)</label>
      <textarea id="av-c" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} className="min-h-20 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink" />
      <button type="submit" disabled={rating === 0 || send.isPending} className="pressable inline-flex min-h-11 w-fit items-center rounded-full bg-brand px-5 text-sm font-semibold text-surface disabled:opacity-50">
        {send.isPending ? 'Enviando…' : 'Enviar avaliação'}
      </button>
      <p className="text-xs text-ink-muted">A avaliação é pública, com seu primeiro nome, e marcada como pedido verificado.</p>
    </form>
  )
}

export function OrderPage() {
  const { id = '' } = useParams()
  const { session } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({
    queryKey: ['orders', 'detail', id],
    queryFn: () => getOrder(id),
    enabled: !!id,
    refetchInterval: (query) => (query.state.data && isFinal(query.state.data.order.status) ? false : 15_000),
  })
  const o = q.data?.order
  const isCustomer = !!o && o.customerId === session?.user.id
  const delivery = useQuery({
    queryKey: ['orders', 'delivery', id, o?.status ?? ''],
    queryFn: () => getMyDelivery(id),
    enabled: isCustomer && o?.fulfillment === 'delivery_partner' && !isFinal(o.status),
    refetchInterval: 15_000,
  })
  // compra concluída = pedido entregue ou retirado (pagamento acontece na entrega/retirada)
  useEffect(() => {
    const d = q.data
    if (!d || !isCustomer || (d.order.status !== 'delivered' && d.order.status !== 'picked_up')) return
    trackPurchase({
      id: d.order.id,
      code: d.order.code,
      totalCents: d.order.totalCents,
      deliveryFeeCents: d.order.deliveryFeeCents,
      affiliation: d.business?.name,
      items: d.items.map((i) => ({ id: i.productId ?? i.id, name: i.name, priceCents: i.unitCents, quantity: i.quantity })),
    })
  }, [q.data, isCustomer])
  const cancel = useMutation({
    mutationFn: () => updateOrderStatus(id, 'cancelled'),
    onSuccess: () => {
      toast.success('Pedido cancelado.')
      void qc.invalidateQueries({ queryKey: ['orders'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível cancelar.'),
  })

  if (q.isLoading) return <Page><p role="status" className="text-sm text-ink-muted">Carregando…</p></Page>
  if (q.isError) return <Page><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Page>
  if (!q.data || !o) return <Page><EmptyState icon={ReceiptText} title="Pedido não encontrado" description="Ele não existe ou não pertence à sua conta." action={<Link to="/pedidos" className="text-sm font-semibold text-brand underline">Meus pedidos</Link>} /></Page>

  const { business, items, events } = q.data
  const done = new Set(events.map((e) => e.status))
  const failed = o.status === 'rejected' || o.status === 'cancelled'
  const wa = whatsappHref(business?.whatsapp ?? null)
  const d = delivery.data

  return (
    <Page>
      <PageHeader icon={ReceiptText} title={`Pedido #${o.code}`} subtitle={`${business?.name ?? 'Estabelecimento'} · ${dateTime.format(new Date(o.createdAt))}`} />

      <section aria-labelledby="st" className={box}>
        <h2 id="st" className="mb-3 text-lg font-semibold text-ink" aria-live="polite">{STATUS_LABEL[o.status]}</h2>
        {failed ? (
          <p className="text-sm text-ink">{o.rejectionReason ? `Motivo: ${o.rejectionReason}` : o.status === 'cancelled' ? 'Pedido cancelado.' : 'Pedido recusado.'}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {expectedSteps(o.fulfillment).map((s) => {
              const ev = events.find((e) => e.status === s)
              return (
                <li key={s} className="flex items-center gap-3 text-sm">
                  <span aria-hidden="true" className={`grid size-6 place-items-center rounded-full ${done.has(s) ? 'bg-success text-surface' : 'border border-line'}`}>{done.has(s) && <Check className="size-4" />}</span>
                  <span className={done.has(s) ? 'font-semibold text-ink' : 'text-ink-muted'}>{STATUS_LABEL[s]}</span>
                  {ev && <span className="text-xs text-ink-muted">{dateTime.format(new Date(ev.createdAt)).split(' ').at(-1)}</span>}
                  <span className="sr-only">{done.has(s) ? 'concluído' : 'pendente'}</span>
                </li>
              )
            })}
          </ol>
        )}
        {isCustomer && o.status === 'placed' && (
          <button type="button" disabled={cancel.isPending} onClick={() => { if (window.confirm('Cancelar este pedido?')) cancel.mutate() }} className="pressable mt-4 inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold text-danger">
            Cancelar pedido
          </button>
        )}
      </section>

      {isCustomer && d && (d.status === 'offered' || d.status === 'accepted' || d.status === 'picked_up') && (
        <section aria-labelledby="ent" className={`${box} flex flex-col gap-2`}>
          <h2 id="ent" className="flex items-center gap-2 text-base font-semibold text-ink"><Bike aria-hidden="true" className="size-5" />Entrega</h2>
          {d.status === 'offered' ? (
            <p className="text-sm text-ink">Procurando um entregador parceiro disponível.</p>
          ) : (
            <>
              <p className="text-sm text-ink">{d.courierName ?? 'Entregador'}{d.vehicle && d.vehicle in VEHICLE_LABEL ? ` · ${VEHICLE_LABEL[d.vehicle as Vehicle]}` : ''} {d.status === 'picked_up' ? 'está a caminho.' : 'vai buscar seu pedido.'}</p>
              {d.code && (
                <p className="flex items-center gap-2 rounded-xl bg-muted p-3 text-sm text-ink">
                  <KeyRound aria-hidden="true" className="size-5" />
                  Código de entrega: <strong className="text-xl tracking-widest">{d.code}</strong>
                </p>
              )}
              <p className="text-xs text-ink-muted">Informe o código ao entregador só quando receber o pedido.</p>
            </>
          )}
        </section>
      )}

      <section aria-labelledby="it" className={box}>
        <h2 id="it" className="mb-2 text-base font-semibold text-ink">Itens</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {items.map((i) => (
            <li key={i.id} className="flex justify-between gap-3">
              <span className="text-ink">
                {i.quantity}× {i.name}
                {i.options.length > 0 && <span className="block text-ink-muted">{i.options.join(', ')}</span>}
                {i.notes && <span className="block text-ink-muted">Obs.: {i.notes}</span>}
              </span>
              <span className="text-ink">{formatBRL(i.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
        <hr className="my-3 border-line" />
        <dl className="grid grid-cols-[1fr_auto] gap-1 text-sm">
          <dt>Subtotal</dt><dd>{formatBRL(o.subtotalCents)}</dd>
          <dt>Entrega</dt><dd>{o.deliveryFeeCents ? formatBRL(o.deliveryFeeCents) : 'Grátis'}</dd>
          {o.discountCents > 0 && <><dt>Desconto</dt><dd>−{formatBRL(o.discountCents)}</dd></>}
          <dt className="font-bold">Total</dt><dd className="font-bold">{formatBRL(o.totalCents)}</dd>
        </dl>
      </section>

      <section aria-labelledby="inf" className={`${box} grid grid-cols-1 gap-1 text-sm sm:grid-cols-2`}>
        <h2 id="inf" className="mb-1 text-base font-semibold text-ink sm:col-span-2">Informações</h2>
        <p><span className="text-ink-muted">Recebimento:</span> {FULFILLMENT_LABEL[o.fulfillment]}</p>
        <p><span className="text-ink-muted">Pagamento:</span> {PAYMENT_LABEL[o.payment]}{o.changeForCents ? ` · troco para ${formatBRL(o.changeForCents)}` : ''}</p>
        {o.address && <p className="sm:col-span-2"><span className="text-ink-muted">Endereço:</span> {o.address}{o.reference ? ` (${o.reference})` : ''}</p>}
        {o.fulfillment === 'pickup' && business?.addressLine && <p className="sm:col-span-2"><span className="text-ink-muted">Retirada em:</span> {business.addressLine}</p>}
        {o.notes && <p className="sm:col-span-2"><span className="text-ink-muted">Observações:</span> {o.notes}</p>}
        {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="pressable mt-2 inline-flex min-h-11 w-fit items-center gap-2 rounded-full border border-line px-4 font-semibold text-ink"><MessageCircle aria-hidden="true" className="size-4" />Falar com o estabelecimento</a>}
      </section>

      {isCustomer && (o.status === 'delivered' || o.status === 'picked_up') && <ReviewBox orderId={o.id} />}
      <Link to="/pedidos" className="text-sm font-semibold text-brand underline">Todos os pedidos</Link>
    </Page>
  )
}
