import { isSupabaseConfigured, supabase } from '../../lib/supabase.ts'
import { ADMIN_USERNAME_DOMAIN } from './schemas.ts'

export { isSupabaseConfigured }

export type SignInError = 'invalid' | 'unconfirmed' | 'rate_limited'

/**
 * Login com e-mail OU nome de usuário (o mesmo para clientes e administração).
 * Com usuário, o banco devolve o e-mail da conta só se a senha conferir (resolve_login);
 * depois o Supabase Auth confere a senha de novo e abre a sessão.
 */
export async function signInWithIdentifier(identifier: string, password: string): Promise<{ error: SignInError | null }> {
  const id = identifier.trim()
  let email: string
  if (id.includes('@')) {
    email = id.toLowerCase()
  } else {
    const { data, error } = await supabase.rpc('resolve_login', { _username: id, _password: password })
    if (error?.code === 'PT429') return { error: 'rate_limited' }
    // sem usuário cadastrado: tenta a conta administrativa por usuário (ex.: admin@tucai.example.com)
    email = typeof data === 'string' && data ? data : `${id.toLowerCase()}@${ADMIN_USERNAME_DOMAIN}`
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (!error) return { error: null }
  return { error: (error as { code?: string }).code === 'email_not_confirmed' ? 'unconfirmed' : 'invalid' }
}

/** @deprecated use signInWithIdentifier */
export async function signInWithPassword(email: string, password: string): Promise<{ error: boolean }> {
  const r = await signInWithIdentifier(email, password)
  return { error: r.error !== null }
}

export const SIGN_IN_MESSAGES: Record<SignInError, string> = {
  invalid: 'Usuário, e-mail ou senha incorretos.',
  unconfirmed: 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.',
  rate_limited: 'Muitas tentativas com este usuário. Aguarde alguns minutos ou entre com o e-mail.',
}

/** Entrar/criar conta com o Google (provedor precisa estar ativo no Supabase). */
export async function signInWithGoogle(): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/conta` } })
  if (!error) return { error: null }
  return {
    error: /not enabled|unsupported provider/i.test(error.message ?? '')
      ? 'O login com Google ainda não foi ativado pela Tucaí. Use e-mail ou usuário.'
      : 'Não foi possível abrir o login do Google. Tente novamente.',
  }
}
