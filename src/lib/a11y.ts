import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY).matches
    : false
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia(QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false)
}

export const SCROLL_DURATION_MS = 300

/** Rola a janela até `top` em 300 ms via requestAnimationFrame; imediato com movimento reduzido. */
export function animateScrollTo(top: number, duration: number = SCROLL_DURATION_MS): void {
  const target = Math.max(0, top)
  if (prefersReducedMotion() || duration <= 0) {
    window.scrollTo(0, target)
    return
  }
  const from = window.scrollY
  let start: number | null = null
  const step = (now: number) => {
    start ??= now
    const t = Math.min(1, (now - start) / duration)
    const eased = 1 - (1 - t) ** 3
    window.scrollTo(0, from + (target - from) * eased)
    if (t < 1) window.requestAnimationFrame(step)
  }
  window.requestAnimationFrame(step)
}
