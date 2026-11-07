import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Falso quando o .env.local ainda não foi preenchido (a UI mostra instruções em vez de quebrar). */
export const isSupabaseConfigured = Boolean(url && anonKey && !url.includes('SEU-PROJETO'))

// Somente a chave pública (anon). A segurança real é RLS no banco.
export const supabase = createClient(
  isSupabaseConfigured ? url! : 'http://localhost:54321',
  isSupabaseConfigured ? anonKey! : 'not-configured',
  { auth: { persistSession: true, autoRefreshToken: true } },
)
