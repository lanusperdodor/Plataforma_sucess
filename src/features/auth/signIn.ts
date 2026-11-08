import { isSupabaseConfigured, supabase } from '../../lib/supabase.ts'

export { isSupabaseConfigured }

/** Login com e-mail/senha pelo Supabase Auth (o mesmo para clientes e administração). */
export async function signInWithPassword(email: string, password: string): Promise<{ error: boolean }> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  return { error: Boolean(error) }
}