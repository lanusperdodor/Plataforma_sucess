import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import { readStorage, removeStorage, writeStorage } from '../../lib/storage'

export const RECENT_KEY = 'recent:v1'
export const RECENT_MAX = 12

export const recentKindSchema = z.enum(['restaurante', 'loja', 'servico', 'vaga', 'post'])

export const recentItemSchema = z.object({
  kind: recentKindSchema,
  id: z.string().min(1),
  slug: z.string().optional(),
  name: z.string(),
  imageUrl: z.string().optional(),
  isDemo: z.boolean(),
  viewedAt: z.string(),
})

export type RecentItem = z.infer<typeof recentItemSchema>
export type RecentInput = Omit<RecentItem, 'viewedAt'> & { viewedAt?: string }

const listSchema = z.array(recentItemSchema)

const EMPTY: readonly RecentItem[] = Object.freeze([])

const listeners = new Set<() => void>()
let cachedRaw: string | null | undefined
let cachedList: readonly RecentItem[] = EMPTY

function rawValue(): string | null {
  try {
    return window.localStorage.getItem(RECENT_KEY)
  } catch {
    return null
  }
}

function dedupe(items: readonly RecentItem[]): RecentItem[] {
  const seen = new Set<string>()
  const out: RecentItem[] = []
  for (const it of items) {
    const k = `${it.kind}:${it.id}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(it)
    if (out.length >= RECENT_MAX) break
  }
  return out
}

function readList(): RecentItem[] {
  return dedupe(readStorage(RECENT_KEY, listSchema) ?? [])
}

/** Lista de últimos vistos (mais recente primeiro). Dado inválido resulta em lista vazia. */
export function listRecent(): RecentItem[] {
  return readList()
}

function notify(): void {
  listeners.forEach((l) => l())
}

export function addRecent(item: RecentInput): void {
  const entry: RecentItem = recentItemSchema.parse({
    ...item,
    viewedAt: item.viewedAt ?? new Date().toISOString(),
  })
  const rest = readList().filter((r) => !(r.kind === entry.kind && r.id === entry.id))
  writeStorage(RECENT_KEY, [entry, ...rest].slice(0, RECENT_MAX))
  notify()
}

export function clearRecent(): void {
  removeStorage(RECENT_KEY)
  notify()
}

/** Snapshot estável: só muda de referência quando o conteúdo bruto do storage muda. */
function getSnapshot(): readonly RecentItem[] {
  const raw = rawValue()
  if (raw !== cachedRaw) {
    cachedRaw = raw
    cachedList = raw === null ? EMPTY : readList()
    if (cachedList.length === 0) cachedList = EMPTY
  }
  return cachedList
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === RECENT_KEY) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useRecent(): readonly RecentItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY)
}
