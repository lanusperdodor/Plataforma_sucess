import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import { readStorage, writeStorage } from '../../lib/storage'

/**
 * Preferências de cookies e rastreamento deste aparelho (LGPD).
 * Necessários: sempre ativos. Análise (GA4) e marketing (Meta Pixel): só com aceite explícito.
 * Registro: escolha, data/hora e versão do texto apresentado. Recusar não limita o uso do site.
 */
export const CONSENT_KEY = 'consent:v1'
/** Mude quando o texto do aviso mudar: o aviso volta a aparecer para nova escolha. */
export const CONSENT_VERSION = '2026-11-11'

const schema = z.object({
  analytics: z.boolean(),
  marketing: z.boolean(),
  decidedAt: z.string(),
  version: z.string(),
})
export type Consent = z.infer<typeof schema>

const listeners = new Set<() => void>()
let cachedRaw: string | null | undefined
let cached: Consent | null = null

function raw(): string | null {
  try {
    return window.localStorage.getItem(CONSENT_KEY)
  } catch {
    return null
  }
}

/** Escolha vigente; null = ainda não decidiu (ou o texto mudou). */
export function readConsent(): Consent | null {
  const c = readStorage(CONSENT_KEY, schema)
  return c && c.version === CONSENT_VERSION ? c : null
}

export function saveConsent(choice: { analytics: boolean; marketing: boolean }): Consent {
  const c: Consent = { ...choice, decidedAt: new Date().toISOString(), version: CONSENT_VERSION }
  writeStorage(CONSENT_KEY, c)
  listeners.forEach((l) => l())
  return c
}

function snapshot(): Consent | null {
  const r = raw()
  if (r !== cachedRaw) {
    cachedRaw = r
    cached = readConsent()
  }
  return cached
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === CONSENT_KEY) l()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(l)
    window.removeEventListener('storage', onStorage)
  }
}

export function useConsent(): Consent | null {
  return useSyncExternalStore(subscribe, snapshot, () => null)
}

export function onConsentChange(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
