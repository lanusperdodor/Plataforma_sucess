import { useSyncExternalStore } from 'react'

export type Breakpoint = 'mobile' | 'tablet' | 'desktop'

const TABLET_QUERY = '(min-width: 768px)'
const DESKTOP_QUERY = '(min-width: 1024px)'

function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
}

function getSnapshot(): Breakpoint {
  if (!hasMatchMedia()) return 'mobile'
  if (window.matchMedia(DESKTOP_QUERY).matches) return 'desktop'
  if (window.matchMedia(TABLET_QUERY).matches) return 'tablet'
  return 'mobile'
}

function getServerSnapshot(): Breakpoint {
  return 'mobile'
}

function subscribe(onChange: () => void): () => void {
  if (!hasMatchMedia()) return () => {}
  const lists = [window.matchMedia(TABLET_QUERY), window.matchMedia(DESKTOP_QUERY)]
  lists.forEach((l) => l.addEventListener('change', onChange))
  return () => lists.forEach((l) => l.removeEventListener('change', onChange))
}

/** Layout atual: mobile (<768), tablet (768–1023) ou desktop (>=1024). */
export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
