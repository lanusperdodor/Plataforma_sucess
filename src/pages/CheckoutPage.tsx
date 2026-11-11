import { useMutation, useQuery } from '@tanstack/react-query'
import { ReceiptText } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { EmptyState } from '../components/feedback/EmptyState.tsx'
import { ErrorState } from '../components/feedback/ErrorState.tsx'
import { useToast } from '../components/feedback/toast-context.ts'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { cartSubtotal, clearCart, useCart } from '../features/cart/cartStore.ts'
import type { BusinessSummary } from '../features/catalog/schemas.ts'
import {
  FULFILLMENT_LABEL,
  PAYMENT_LABEL,
  checkoutSchema,
  newIdempotencyKey,
  payments,
  placeOrder,
  previewDeliveryFee,
  type CheckoutForm,
  type Fulfillment,
} from '../features/orders/repository.ts'
import { getPublicBusiness } from '../features/store/repository.ts'
import { formatBRL } from '../lib/money.ts'
import { trackBeginCheckout } from '../features/tracking/tracker.ts'

const field = 'min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink'

/** Modalidades que a loja oferece hoje. */
export function availableFulfillments(b: Pick<BusinessSummary, 'deliveryOffer' | 'acceptsPickup'>): Fulfillment[] {
  const out: Fulfillment[] = []
  if (b.deliveryOffer === 'own') out.push('delivery_own')
  if (b.deliveryOffer === 'partner') out.push('delivery_partner')
  if (b.acceptsPickup) out.push('pickup')
  return out
}

function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-ink">{children}</label>
}

export function CheckoutPage() {
  const cart = useCart()
  const navigate = useNavigate()
  const toast = useToast()
  const business = useQuery({ queryKey: ['store', 'business', cart?.business.slug ?? ''], queryFn: () => getPublicBusiness(cart!.business.slug), enabled: !!cart })
  const key = useRef(newIdempotencyKey())
  const [v, setV] = useState<CheckoutForm>({ fulfillment: 'pickup', payment: 'pix_on_delivery', customerName: '', customerPhone: '', address: '', reference: '', notes: '', changeFor: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = <K extends keyof CheckoutForm>(k: K, val: CheckoutForm[K]) => setV((p) => ({ ...p, [k]: val }))
  const startedFor = useRef('')
  useEffect(() => {
    if (!cart || startedFor.current === cart.business.id) return
    startedFor.current = cart.business.id
    trackBeginCheckout(
      cart.lines.map((l) => ({ id: l.productId, name: l.name, priceCents: l.unitCents, quantity: l.quantity, affiliation: cart.business.name })),
      cartSubtotal(cart),
    )
  }, [cart])

  const place = useMutation({
    mutationFn: (input: CheckoutForm) => placeOrder(cart!, input, key.current),
    onSuccess: (id) => {
      clearCart()
      toast.success('Pedido enviado ao estabelecimento.')
      navigate(`/pedidos/${id}`, { replace: true })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível enviar o pedido.'),
  })

  if (!cart) {
    return (
      <Page>
        <EmptyState icon={ReceiptText} title="Sua sacola está vazia" description="Adicione itens antes de finalizar." action={<Link to="/restaurantes" className="pressable inline-flex min-h-11 items-center rounded-full bg-orange px-5 text-sm font-semibold text-ink">Ver restaurantes</Link>} />
      </Page>
    )
  }
  if (business.isLoading) return <Page><p role="status" className="text-sm text-ink-muted">Carregando…</p></Page>
  if (business.isError) return <Page><ErrorState error={business.error} onRetry={() => void business.refetch()} /></Page>
  const b = business.data
  if (!b) return <Page><EmptyState icon={ReceiptText} title="Estabelecimento indisponível" description="Ele não está mais ativo na Tucaí. Esvazie a sacola e escolha outro." /></Page>

  const modes = availableFulfillments(b)
  if (modes.length === 0) return <Page><EmptyState icon={ReceiptText} title="Sem entrega ou retirada" description="Este estabelecimento desativou os pedidos pela Tucaí." /></Page>
  const mode = modes.includes(v.fulfillment) ? v.fulfillment : modes[0]!
  const subtotal = cartSubtotal(cart)
  const fee = previewDeliveryFee(mode, b)
  const belowMin = subtotal < b.minOrderCents

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const input = { ...v, fulfillment: mode }
    const parsed = checkoutSchema.safeParse(input)
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])))
    setErrors({})
    place.mutate(input)
  }
  const err = (k: string) => (errors[k] ? <p role="alert" className="mt-1 text-xs text-danger">{errors[k]}</p> : null)

  return (
    <Page>
      <PageHeader icon={ReceiptText} title="Finalizar pedido" subtitle={b.name} />
      <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
            <legend className="px-1 text-sm font-semibold text-ink">Como receber</legend>
            {modes.map((m) => (
              <label key={m} className={`flex min-h-11 items-center gap-3 rounded-xl border px-3 text-sm ${mode === m ? 'border-brand' : 'border-line'}`}>
                <input type="radio" name="co-mode" className="size-5" checked={mode === m} onChange={() => set('fulfillment', m)} />
                <span className="flex-1 text-ink">{FULFILLMENT_LABEL[m]}</span>
                <span className="text-ink-muted">{previewDeliveryFee(m, b) ? formatBRL(previewDeliveryFee(m, b)) : 'Grátis'}</span>
              </label>
            ))}
            {mode === 'pickup' && b.addressLine && <p className="text-sm text-ink-muted">Retirar em: {b.addressLine}</p>}
            {mode === 'delivery_own' && <p className="text-sm text-ink-muted">O próprio estabelecimento leva o pedido até você.</p>}
            {mode === 'delivery_partner' && <p className="text-sm text-ink-muted">Um entregador parceiro da Tucaí coleta no estabelecimento quando o pedido ficar pronto.</p>}
          </fieldset>

          <fieldset className="grid grid-cols-1 gap-3 rounded-card border border-line bg-surface p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold text-ink">Seus dados</legend>
            <div><Label htmlFor="co-name">Nome</Label><input id="co-name" autoComplete="name" value={v.customerName} onChange={(e) => set('customerName', e.target.value)} aria-invalid={!!errors.customerName} className={field} />{err('customerName')}</div>
            <div><Label htmlFor="co-phone">Telefone / WhatsApp</Label><input id="co-phone" type="tel" autoComplete="tel" value={v.customerPhone} onChange={(e) => set('customerPhone', e.target.value)} aria-invalid={!!errors.customerPhone} className={field} />{err('customerPhone')}</div>
            {mode !== 'pickup' && (
              <>
                <div className="sm:col-span-2"><Label htmlFor="co-addr">Endereço (rua, número, bairro)</Label><input id="co-addr" autoComplete="street-address" maxLength={300} value={v.address} onChange={(e) => set('address', e.target.value)} aria-invalid={!!errors.address} className={field} />{err('address')}</div>
                <div className="sm:col-span-2"><Label htmlFor="co-ref">Ponto de referência (opcional)</Label><input id="co-ref" maxLength={200} value={v.reference} onChange={(e) => set('reference', e.target.value)} className={field} /></div>
              </>
            )}
            <div className="sm:col-span-2"><Label htmlFor="co-notes">Observações para o estabelecimento (opcional)</Label><textarea id="co-notes" maxLength={500} value={v.notes} onChange={(e) => set('notes', e.target.value)} className={`${field} min-h-16 py-2`} /></div>
          </fieldset>

          <fieldset className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
            <legend className="px-1 text-sm font-semibold text-ink">Pagamento</legend>
            {payments.map((p) => (
              <label key={p} className={`flex min-h-11 items-center gap-3 rounded-xl border px-3 text-sm ${v.payment === p ? 'border-brand' : 'border-line'}`}>
                <input type="radio" name="co-pay" className="size-5" checked={v.payment === p} onChange={() => set('payment', p)} />
                <span className="text-ink">{PAYMENT_LABEL[p]}</span>
              </label>
            ))}
            {v.payment === 'cash' && (
              <div className="max-w-xs"><Label htmlFor="co-change">Troco para (R$, opcional)</Label><input id="co-change" inputMode="decimal" placeholder="100" value={v.changeFor} onChange={(e) => set('changeFor', e.target.value)} aria-invalid={!!errors.changeFor} className={field} />{err('changeFor')}</div>
            )}
            <p className="text-xs text-ink-muted">Pagamento online ainda não está disponível. Você paga direto ao estabelecimento ou ao entregador.</p>
          </fieldset>
        </div>

        <aside className="flex h-fit flex-col gap-2 rounded-card border border-line bg-surface p-4 lg:sticky lg:top-4">
          <h2 className="text-base font-semibold text-ink">Resumo</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {cart.lines.map((l) => (
              <li key={l.key} className="flex justify-between gap-2"><span className="text-ink">{l.quantity}× {l.name}</span><span className="text-ink">{formatBRL(l.unitCents * l.quantity)}</span></li>
            ))}
          </ul>
          <hr className="border-line" />
          <p className="flex justify-between text-sm"><span>Subtotal</span><span>{formatBRL(subtotal)}</span></p>
          <p className="flex justify-between text-sm"><span>Entrega</span><span>{fee ? formatBRL(fee) : 'Grátis'}</span></p>
          <p className="flex justify-between text-base font-bold"><span>Total</span><span>{formatBRL(subtotal + fee)}</span></p>
          {belowMin && <p role="alert" className="text-sm text-danger">Pedido mínimo: {formatBRL(b.minOrderCents)}.</p>}
          {!b.isOpen && <p role="alert" className="text-sm text-danger">O estabelecimento está fechado agora.</p>}
          <button type="submit" disabled={place.isPending || belowMin || !b.isOpen} className="pressable mt-2 inline-flex min-h-12 items-center justify-center rounded-full bg-orange px-6 text-base font-semibold text-ink disabled:opacity-50">
            {place.isPending ? 'Enviando…' : 'Fazer pedido'}
          </button>
          <p className="text-xs text-ink-muted">O total é conferido pelo servidor com os preços atuais da loja antes de registrar o pedido.</p>
        </aside>
      </form>
    </Page>
  )
}
