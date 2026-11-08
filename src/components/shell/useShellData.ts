/** Hooks provisórios do shell; serão ligados à sacola e às notificações reais depois. */

export interface CartSummary {
  count: number
  totalCents: number
}

const EMPTY_CART: CartSummary = { count: 0, totalCents: 0 }

export function useCartSummary(): CartSummary {
  return EMPTY_CART
}

export function useUnreadCount(): number {
  return 0
}

/** Contador de selo: 0 oculto (string vazia), 1–9 literal, acima disso "9+". */
export function formatBadge(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  const i = Math.floor(n)
  if (i <= 0) return ''
  return i > 9 ? '9+' : String(i)
}
