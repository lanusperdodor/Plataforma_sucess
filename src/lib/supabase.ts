import { createClient } from '@supabase/supabase-js'

import { SUPABASE_PUBLIC } from '../config/supabase-public'

// Em testes (MODE=test) não há padrão: cada teste decide se o Supabase está configurado.
const fallback = import.meta.env.MODE === 'test' ? undefined : SUPABASE_PUBLIC
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || fallback?.url
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || fallback?.publishableKey

/** Falso quando o .env.local ainda não foi preenchido (a UI mostra instruções em vez de quebrar). */
export const isSupabaseConfigured = Boolean(url && anonKey && !url.includes('SEU-PROJETO'))

// Somente a chave pública (anon). A segurança real é RLS no banco.
export const supabase = createClient(
  isSupabaseConfigured ? url! : 'http://localhost:54321',
  isSupabaseConfigured ? anonKey! : 'not-configured',
  { auth: { persistSession: true, autoRefreshToken: true } },
)
