import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import type { Rpc } from '../../seo/resolve'

/** Funções públicas de SEO do banco (0017); null quando o banco não responde. */
export const seoRpc: Rpc = async <T,>(fn: string, args: Record<string, unknown> = {}) => {
  if (!isSupabaseConfigured) return null
  try {
    const { data, error } = await supabase.rpc(fn, args)
    return error ? null : (data as T)
  } catch {
    return null
  }
}
