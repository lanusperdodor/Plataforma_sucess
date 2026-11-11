import { Minus, Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Img } from '../../components/feedback/Img.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { Sheet } from '../../components/overlays/Sheet.tsx'
import { MAX_QTY, addToCart, type CartBusiness } from '../../features/cart/cartStore.ts'
import type { MenuGroup, MenuProduct } from '../../features/store/repository.ts'
import { formatBRL } from '../../lib/money.ts'

/** Escolhas inválidas por grupo (mínimo/máximo). Mesma regra que o servidor confere. */
export function groupErrors(groups: MenuGroup[], chosen: Record<string, string[]>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const g of groups) {
    const n = (chosen[g.id] ?? []).length
    if (n < g.minSelect) out[g.id] = g.minSelect === 1 ? 'Escolha 1 opção.' : `Escolha pelo menos ${g.minSelect}.`
    else if (n > g.maxSelect) out[g.id] = `Escolha no máximo ${g.maxSelect}.`
  }
  return out
}

export function unitPrice(p: MenuProduct, chosen: Record<string, string[]>): number {
  const ids = new Set(Object.values(chosen).flat())
  return p.priceCents + p.groups.flatMap((g) => g.options).filter((o) => ids.has(o.id)).reduce((s, o) => s + o.priceDeltaCents, 0)
}

export function ProductSheet({ product, business, onClose }: { product: MenuProduct; business: CartBusiness; onClose: () => void }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [chosen, setChosen] = useState<Record<string, string[]>>({})
  const [qty, setQty] = useState(1)
  const [notes, setNotes] = useState('')
  const [tried, setTried] = useState(false)
  const errors = groupErrors(product.groups, chosen)
  const unit = unitPrice(product, chosen)

  const toggle = (g: MenuGroup, optionId: string) =>
    setChosen((prev) => {
      const cur = prev[g.id] ?? []
      if (g.maxSelect === 1) return { ...prev, [g.id]: cur[0] === optionId && g.minSelect === 0 ? [] : [optionId] }
      if (cur.includes(optionId)) return { ...prev, [g.id]: cur.filter((x) => x !== optionId) }
      if (cur.length >= g.maxSelect) return prev
      return { ...prev, [g.id]: [...cur, optionId] }
    })

  const add = (replace = false) => {
    setTried(true)
    if (Object.keys(errors).length > 0) return
    const optionIds = product.groups.flatMap((g) => chosen[g.id] ?? [])
    const labels = product.groups.flatMap((g) => g.options.filter((o) => (chosen[g.id] ?? []).includes(o.id)).map((o) => o.name))
    const r = addToCart(business, { productId: product.id, name: product.name, unitCents: unit, quantity: qty, optionIds, optionLabels: labels, notes }, replace)
    if (r === 'other_business') {
      if (window.confirm('Sua sacola tem itens de outro estabelecimento. Esvaziar a sacola e começar uma nova aqui?')) add(true)
      return
    }
    toast.success(`${product.name} adicionado à sacola.`)
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title={product.name} className="bg-surface">
      <div className="flex flex-col gap-4 overflow-y-auto p-4">
        {product.imageUrl && <Img src={product.imageUrl} alt="" width={480} height={270} className="aspect-video w-full rounded-xl object-cover" />}
        {product.description && <p className="text-sm text-ink-muted">{product.description}</p>}
        <p className="text-lg font-bold text-ink">{formatBRL(product.priceCents)}</p>
        {product.groups.map((g) => {
          const multi = g.maxSelect > 1
          const err = tried ? errors[g.id] : undefined
          return (
            <fieldset key={g.id} className="flex flex-col gap-2" aria-describedby={err ? `ge-${g.id}` : undefined}>
              <legend className="mb-1 flex w-full items-center justify-between gap-2 text-sm font-semibold text-ink">
                {g.name}
                <span className="text-xs font-normal text-ink-muted">
                  {g.minSelect > 0 ? 'Obrigatório · ' : 'Opcional · '}
                  {multi ? `até ${g.maxSelect}` : 'escolha 1'}
                </span>
              </legend>
              {g.options.map((o) => {
                const checked = (chosen[g.id] ?? []).includes(o.id)
                return (
                  <label key={o.id} className={`flex min-h-11 items-center gap-3 rounded-xl border px-3 text-sm ${checked ? 'border-brand' : 'border-line'} ${o.isAvailable ? '' : 'opacity-50'}`}>
                    <input
                      type={multi ? 'checkbox' : 'radio'}
                      name={`g-${g.id}`}
                      className="size-5"
                      checked={checked}
                      disabled={!o.isAvailable}
                      onChange={() => toggle(g, o.id)}
                    />
                    <span className="flex-1 text-ink">{o.name}{!o.isAvailable && ' (indisponível)'}</span>
                    {o.priceDeltaCents > 0 && <span className="text-ink-muted">+{formatBRL(o.priceDeltaCents)}</span>}
                  </label>
                )
              })}
              {err && <p id={`ge-${g.id}`} role="alert" className="text-xs text-danger">{err}</p>}
            </fieldset>
          )
        })}
        <div>
          <label htmlFor="ps-notes" className="mb-1 block text-sm font-medium text-ink">Observação (opcional)</label>
          <textarea id="ps-notes" maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: sem cebola" className="min-h-16 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink" />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-full border border-line">
            <button type="button" aria-label="Diminuir quantidade" disabled={qty <= 1} onClick={() => setQty((q) => q - 1)} className="pressable inline-flex size-11 items-center justify-center disabled:opacity-40"><Minus aria-hidden="true" className="size-4" /></button>
            <span aria-live="polite" className="min-w-8 text-center font-semibold text-ink">{qty}</span>
            <button type="button" aria-label="Aumentar quantidade" disabled={qty >= MAX_QTY} onClick={() => setQty((q) => q + 1)} className="pressable inline-flex size-11 items-center justify-center disabled:opacity-40"><Plus aria-hidden="true" className="size-4" /></button>
          </div>
          <button type="button" onClick={() => add()} className="pressable inline-flex min-h-12 flex-1 items-center justify-between gap-2 rounded-full bg-orange px-5 font-semibold text-ink">
            <span>Adicionar</span><span>{formatBRL(unit * qty)}</span>
          </button>
        </div>
        <div className="flex justify-between gap-2">
          <button type="button" onClick={onClose} className="pressable inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold text-ink">Fechar</button>
          <button type="button" onClick={() => { onClose(); navigate('/sacola') }} className="pressable inline-flex min-h-11 items-center px-2 text-sm font-semibold text-brand underline">Ver sacola</button>
        </div>
      </div>
    </Sheet>
  )
}
