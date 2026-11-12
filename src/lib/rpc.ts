import type { z } from 'zod'
import { RepositoryError, backendUnavailable, mapPostgrestError } from './errors'
import { isSupabaseConfigured, supabase } from './supabase'

type Res = { data: unknown; error: { code?: string; message: string; hint?: string } | null }

/** Chama uma função do banco (RPC), traduz o erro e valida a resposta. A autorização é sempre do banco. */
export async function rpc<T>(fn: string, args: Record<string, unknown> | undefined, schema: z.ZodType<T>): Promise<T> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  let res: Res
  try {
    res = (await supabase.rpc(fn, args)) as Res
  } catch (e) {
    throw mapPostgrestError({ message: e instanceof Error ? e.message : String(e) })
  }
  if (res.error) throw mapPostgrestError(res.error)
  const parsed = schema.safeParse(res.data)
  if (!parsed.success) throw new RepositoryError('validation', 'Recebemos dados inesperados do servidor.', undefined, { cause: parsed.error })
  return parsed.data
}
