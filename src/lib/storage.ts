import type { ZodType } from 'zod'

export type StorageKind = 'local' | 'session'

function getStore(kind: StorageKind): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

/** Lê e valida um valor JSON. Dado inválido é descartado (chave removida). Nunca lança. */
export function readStorage<T>(
  key: string,
  schema: ZodType<T>,
  kind: StorageKind = 'local',
): T | null {
  const store = getStore(kind)
  if (!store) return null
  try {
    const raw = store.getItem(key)
    if (raw === null) return null
    const parsed = schema.safeParse(JSON.parse(raw))
    if (parsed.success) return parsed.data
  } catch {
    // JSON inválido ou storage indisponível: cai no descarte abaixo
  }
  removeStorage(key, kind)
  return null
}

/** Grava um valor como JSON. Devolve false se falhar (indisponível/quota). Nunca lança. */
export function writeStorage(key: string, value: unknown, kind: StorageKind = 'local'): boolean {
  const store = getStore(kind)
  if (!store) return false
  try {
    store.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function removeStorage(key: string, kind: StorageKind = 'local'): void {
  try {
    getStore(kind)?.removeItem(key)
  } catch {
    // ignorado
  }
}
