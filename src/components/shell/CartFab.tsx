import { ShoppingBag } from 'lucide-react'
import { formatBRL } from '../../lib/money.ts'

export type CartFabProps = {
  count: number
  totalCents: number
  onOpen: () => void
}

export function CartFab({ count, totalCents, onOpen }: CartFabProps) {
  if (count <= 0) return null
  const total = formatBRL(totalCents)
  const itens = count === 1 ? '1 item' : `${count} itens`

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Ver sacola, ${itens}, total ${total}`}
      className="pressable fixed right-4 flex min-h-12 items-center gap-3 rounded-full border-0 bg-brand px-4 py-2 font-semibold text-surface"
      style={{
        zIndex: 'var(--z-nav)',
        bottom: 'calc(var(--bottom-nav-h) + env(safe-area-inset-bottom) + 0.75rem)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <span className="relative flex items-center" aria-hidden="true">
        <ShoppingBag size={20} />
        <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-surface px-1 text-[0.625rem] font-bold text-brand">
          {count}
        </span>
      </span>
      <span aria-hidden="true">{total}</span>
    </button>
  )
}
