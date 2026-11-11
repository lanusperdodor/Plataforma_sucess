import { Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/feedback/EmptyState.tsx'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { MAX_QTY, cartSubtotal, clearCart, setLineQuantity, useCart } from '../features/cart/cartStore.ts'
import { formatBRL } from '../lib/money.ts'

const primary = 'pressable inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-orange px-6 text-base font-semibold text-ink'

/** Sacola deste aparelho. Os valores finais são calculados pelo servidor ao confirmar. */
export function CartPage() {
  const cart = useCart()
  if (!cart) {
    return (
      <Page>
        <PageHeader icon={ShoppingBag} title="Sacola" subtitle="Itens de um estabelecimento por vez, com total antes de confirmar." />
        <EmptyState
          icon={ShoppingBag}
          title="Sua sacola está vazia"
          description="Escolha um restaurante ou loja e toque em Adicionar nos itens."
          action={<Link to="/restaurantes" className="pressable inline-flex min-h-11 items-center rounded-full bg-orange px-5 text-sm font-semibold text-ink">Ver restaurantes</Link>}
        />
      </Page>
    )
  }
  const subtotal = cartSubtotal(cart)
  return (
    <Page>
      <PageHeader icon={ShoppingBag} title="Sacola" subtitle={`Pedido em ${cart.business.name}`} />
      <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
        {cart.lines.map((l) => (
          <li key={l.key} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">{l.name}</p>
              {l.optionLabels.length > 0 && <p className="text-sm text-ink-muted">{l.optionLabels.join(', ')}</p>}
              {l.notes && <p className="text-sm text-ink-muted">Obs.: {l.notes}</p>}
              <p className="text-sm text-ink">{formatBRL(l.unitCents)} cada</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center rounded-full border border-line">
                <button type="button" aria-label={l.quantity === 1 ? `Remover ${l.name}` : `Diminuir ${l.name}`} onClick={() => setLineQuantity(l.key, l.quantity - 1)} className="pressable inline-flex size-11 items-center justify-center">
                  {l.quantity === 1 ? <Trash2 aria-hidden="true" className="size-4 text-danger" /> : <Minus aria-hidden="true" className="size-4" />}
                </button>
                <span className="min-w-8 text-center font-semibold text-ink" aria-label={`Quantidade de ${l.name}`}>{l.quantity}</span>
                <button type="button" aria-label={`Aumentar ${l.name}`} disabled={l.quantity >= MAX_QTY} onClick={() => setLineQuantity(l.key, l.quantity + 1)} className="pressable inline-flex size-11 items-center justify-center disabled:opacity-40">
                  <Plus aria-hidden="true" className="size-4" />
                </button>
              </div>
              <span className="w-24 text-right font-semibold text-ink">{formatBRL(l.unitCents * l.quantity)}</span>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
        <p className="flex justify-between text-base"><span className="text-ink">Subtotal</span><span className="font-bold text-ink">{formatBRL(subtotal)}</span></p>
        <p className="text-xs text-ink-muted">Taxa de entrega e total final aparecem no próximo passo e são confirmados pelo servidor com os preços atuais da loja.</p>
        <Link to="/sacola/checkout" className={primary}>Continuar</Link>
        <div className="flex flex-wrap justify-between gap-2">
          <Link to={`/restaurantes/${cart.business.slug}`} className="pressable inline-flex min-h-11 items-center text-sm font-semibold text-brand underline">Adicionar mais itens</Link>
          <button type="button" onClick={() => { if (window.confirm('Esvaziar a sacola?')) clearCart() }} className="pressable inline-flex min-h-11 items-center text-sm font-semibold text-danger">Esvaziar sacola</button>
        </div>
      </div>
    </Page>
  )
}
