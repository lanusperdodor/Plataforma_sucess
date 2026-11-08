import { useSyncExternalStore } from 'react'
import { isSupabaseConfigured } from './supabase'

/**
 * Origem dos dados do catálogo público.
 * - 'remote': Supabase com as tabelas da experiência do cliente.
 * - 'demo': dados LOCAIS de demonstração (prévia visual). Nunca representam operações reais.
 */
export type DataSourceMode = 'remote' | 'demo'

export interface DataSourceState {
  mode: DataSourceMode
  reason: string | null
}

/** Forçar demonstração: VITE_DEMO_DATA=1 no .env.local (útil enquanto as migrations não forem aplicadas). */
const FORCED = import.meta.env.VITE_DEMO_DATA === '1'

let state: DataSourceState =
  !isSupabaseConfigured || FORCED
    ? { mode: 'demo', reason: !isSupabaseConfigured ? 'Supabase não configurado' : 'VITE_DEMO_DATA=1' }
    : { mode: 'remote', reason: null }
const listeners = new Set<() => void>()

export function getDataSource(): DataSourceState {
  return state
}

/** Chamado pelos repositórios quando o banco ainda não tem as tabelas (ex.: PGRST205). */
export function switchToDemo(reason: string): void {
  if (state.mode === 'demo') return
  state = { mode: 'demo', reason }
  listeners.forEach((l) => l())
}

/** Somente testes. */
export function resetDataSourceForTests(next: DataSourceState): void {
  state = next
  listeners.forEach((l) => l())
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useDataSource(): DataSourceState {
  return useSyncExternalStore(subscribe, getDataSource, getDataSource)
}

/** Códigos que indicam tabela/visão/função inexistente no banco (migrations ainda não aplicadas). */
const MISSING_SCHEMA_CODES = new Set(['PGRST205', 'PGRST202', '42P01', '42883'])

export function isMissingSchemaError(e: unknown): boolean {
  const cause = (e as { cause?: { code?: string } } | null)?.cause
  const code = cause?.code ?? (e as { code?: string } | null)?.code
  return typeof code === 'string' && MISSING_SCHEMA_CODES.has(code)
}