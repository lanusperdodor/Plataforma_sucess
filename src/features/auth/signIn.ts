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
  // volta para o login único, que reconhece o perfil e abre o painel certo (Master, empresário, entregador, cliente…)
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/entrar` } })
  if (!error) return { error: null }
  return {
    error: /not enabled|unsupported provider/i.test(error.message ?? '')
      ? 'O login com Google ainda não foi ativado pela Tucaí. Use e-mail ou usuário.'
      : 'Não foi possível abrir o login do Google. Tente novamente.',
  }
}

/** Erro devolvido pelo Google/Supabase na volta do OAuth (?error=… ou #error=…), em português. Nunca expõe detalhes técnicos. */
export function oauthReturnError(search: string, hash: string): string | null {
  const read = (raw: string) => new URLSearchParams(raw.replace(/^[?#]/, ''))
  const q = read(search)
  const h = read(hash)
  const code = q.get('error_code') ?? h.get('error_code') ?? q.get('error') ?? h.get('error')
  if (!code) return null
  const desc = `${q.get('error_description') ?? h.get('error_description') ?? ''} ${code}`.toLowerCase()
  if (/access_denied/.test(desc)) return 'Login com Google cancelado. Você pode tentar de novo ou entrar com e-mail ou usuário.'
  if (/not enabled|unsupported provider/.test(desc)) return 'O login com Google ainda não foi ativado pela Tucaí. Use e-mail ou usuário.'
  if (/redirect|not allowed/.test(desc)) return 'O login com Google não está autorizado para este endereço do site. A equipe Tucaí precisa concluir a configuração.'
  return 'Não foi possível concluir o login com Google. Tente novamente ou entre com e-mail ou usuário.'
}
