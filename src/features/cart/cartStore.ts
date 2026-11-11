import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import { readStorage, removeStorage, writeStorage } from '../../lib/storage'

/**
 * Sacola deste aparelho (localStorage). Uma loja por vez. Os preços guardados aqui servem só
 * para exibição: o valor cobrado é recalculado pelo servidor ao confirmar o pedido.
 */

export const CART_KEY = 'cart:v1'
export const MAX_LINES = 50
export const MAX_QTY = 50

const lineSchema = z.object({
  key: z.string(),
  productId: z.string().min(1),
  name: z.string(),
  unitCents: z.number().int().nonnegative(),
  quantity: z.number().int().min(1).max(MAX_QTY),
  optionIds: z.array(z.string()),
  optionLabels: z.array(z.string()),
  notes: z.string().max(200),
})
const cartSchema = z.object({
  business: z.object({ id: z.string().min(1), slug: z.string(), name: z.string() }),
  lines: z.array(lineSchema).max(MAX_LINES),
})

export type CartLine = z.infer<typeof lineSchema>
export type Cart = z.infer<typeof cartSchema>
export type CartBusiness = Cart['business']
export type CartLineInput = Omit<CartLine, 'key'>

const listeners = new Set<() => void>()
let cachedRaw: string | null | undefined
let cached: Cart | null = null

function raw(): string | null {
  try {
    return window.localStorage.getItem(CART_KEY)
  } catch {
    return null
  }
}

export function readCart(): Cart | null {
  const c = readStorage(CART_KEY, cartSchema)
  return c && c.lines.length > 0 ? c : null
}

function save(c: Cart | null): void {
  if (!c || c.lines.length === 0) removeStorage(CART_KEY)
  else writeStorage(CART_KEY, c)
  listeners.forEach((l) => l())
}

/** Mesmo produto com as mesmas escolhas e observação vira uma linha só. */
export function lineKey(l: Pick<CartLine, 'productId' | 'optionIds' | 'notes'>): string {
  return [l.productId, [...l.optionIds].sort().join(','), l.notes.trim()].join('|')
}

export type AddResult = 'added' | 'other_business'

/** Adiciona; se a sacola for de outra loja, não mexe e devolve 'other_business' (a interface pergunta). */
export function addToCart(business: CartBusiness, input: CartLineInput, replace = false): AddResult {
  const current = readCart()
  if (current && current.business.id !== business.id && !replace) return 'other_business'
  const base: Cart = current && current.business.id === business.id ? current : { business, lines: [] }
  const line: CartLine = { ...input, notes: input.notes.trim().slice(0, 200), key: '' }
  line.key = lineKey(line)
  const existing = base.lines.find((l) => l.key === line.key)
  const lines = existing
    ? base.lines.map((l) => (l.key === line.key ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + line.quantity), unitCents: line.unitCents, name: line.name } : l))
    : [...base.lines, line].slice(0, MAX_LINES)
  save({ business, lines })
  return 'added'
}

export function setLineQuantity(key: string, quantity: number): void {
  const c = readCart()
  if (!c) return
  const lines = quantity <= 0 ? c.lines.filter((l) => l.key !== key) : c.lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(MAX_QTY, Math.floor(quantity)) } : l))
  save({ ...c, lines })
}

export function clearCart(): void {
  save(null)
}

export function cartSubtotal(c: Cart | null): number {
  return c ? c.lines.reduce((s, l) => s + l.unitCents * l.quantity, 0) : 0
}

export function cartCount(c: Cart | null): number {
  return c ? c.lines.reduce((s, l) => s + l.quantity, 0) : 0
}

function getSnapshot(): Cart | null {
  const r = raw()
  if (r !== cachedRaw) {
    cachedRaw = r
    cached = r === null ? null : readCart()
  }
  return cached
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === CART_KEY) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useCart(): Cart | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null)
}
