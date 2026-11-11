import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../features/auth/AuthProvider.tsx'
import { cartCount, cartSubtotal, useCart } from '../../features/cart/cartStore.ts'
import { countUnread } from '../../features/conecta/repository.ts'

/** Hooks do shell. */

export interface CartSummary {
  count: number
  totalCents: number
}

/** Resumo da sacola deste aparelho (valores de exibição; o servidor recalcula no pedido). */
export function useCartSummary(): CartSummary {
  const cart = useCart()
  return { count: cartCount(cart), totalCents: cartSubtotal(cart) }
}

/** Notificações não lidas do Conectuaí (0 sem sessão). Atualiza a cada minuto. */
export function useUnreadCount(): number {
  const { session } = useAuth()
  const me = session?.user.id
  const q = useQuery({ queryKey: ['me', 'unread', me ?? ''], queryFn: () => countUnread(me!), enabled: !!me, refetchInterval: 60_000, staleTime: 30_000 })
  return me ? q.data ?? 0 : 0
}

/** Contador de selo: 0 oculto (string vazia), 1–9 literal, acima disso "9+". */
export function formatBadge(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  const i = Math.floor(n)
  if (i <= 0) return ''
  return i > 9 ? '9+' : String(i)
}
