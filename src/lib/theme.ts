import { useSyncExternalStore } from 'react'

/** Tema da interface: claro, escuro ou automático (segue o aparelho). Preferência só neste navegador. */
export type ThemePreference = 'light' | 'dark' | 'system'
const KEY = 'tucai:theme'
const listeners = new Set<() => void>()

function media(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
}

export function getThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function resolveTheme(p: ThemePreference = getThemePreference()): 'light' | 'dark' {
  if (p !== 'system') return p
  return media()?.matches ? 'dark' : 'light'
}

function apply() {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = resolveTheme()
  listeners.forEach((l) => l())
}

export function setThemePreference(p: ThemePreference) {
  try {
    if (p === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, p)
  } catch {
    // sem armazenamento (aba privada): vale só até recarregar
  }
  apply()
}

media()?.addEventListener?.('change', () => {
  if (getThemePreference() === 'system') apply()
})

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useTheme(): { preference: ThemePreference; resolved: 'light' | 'dark'; setPreference: (p: ThemePreference) => void } {
  const preference = useSyncExternalStore(subscribe, getThemePreference, () => 'system' as ThemePreference)
  const resolved = useSyncExternalStore(subscribe, () => resolveTheme(), () => 'light' as const)
  return { preference, resolved, setPreference: setThemePreference }
}
