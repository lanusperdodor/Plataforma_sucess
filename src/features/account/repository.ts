import { z } from 'zod'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'

/** Dados reais da conta conectada para o menu de conta (perfil e nomes dos estabelecimentos vinculados). */
const profileSchema = z.object({ full_name: z.string().nullable(), username: z.string().nullable().optional() }).nullable()
const bizSchema = z.array(z.object({ id: z.string(), name: z.string() }))

export interface AccountIdentity {
  fullName: string | null
  username: string | null
  businesses: Record<string, string>
}

export async function getAccountIdentity(userId: string, businessIds: readonly string[]): Promise<AccountIdentity> {
  if (!isSupabaseConfigured) return { fullName: null, username: null, businesses: {} }
  const [p, b] = await Promise.all([
    supabase.from('profiles').select('full_name,username').eq('id', userId).maybeSingle(),
    businessIds.length ? supabase.from('businesses').select('id,name').in('id', [...businessIds]) : Promise.resolve({ data: [], error: null }),
  ])
  if (p.error) throw p.error
  const prof = profileSchema.parse(p.data)
  const biz = b.error ? [] : bizSchema.parse(b.data ?? [])
  return {
    fullName: prof?.full_name?.trim() || null,
    username: prof?.username ?? null,
    businesses: Object.fromEntries(biz.map((x) => [x.id, x.name])),
  }
}

/** Precisa trocar a senha (senha temporária definida pelo suporte/Master). */
export async function mustChangePassword(): Promise<boolean> {
  if (!isSupabaseConfigured) return false
  const { data, error } = await supabase.rpc('must_change_password')
  if (error) return false // banco sem a 0023: não bloqueia o acesso
  return data === true
}

/**
 * Link seguro do Supabase Auth: recuperação de senha (fluxo público de "esqueci a senha").
 * Nenhuma chave privada envolvida; quem recebe o link cria a própria senha em /nova-senha.
 */
export async function sendPasswordRecoveryEmail(email: string): Promise<void> {
  if (!isSupabaseConfigured) throw new Error('Supabase não configurado.')
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/nova-senha` })
  if (error) throw new Error(error.message || 'Não foi possível enviar o e-mail.')
}

/**
 * Convite: link de acesso por e-mail (Supabase Auth). Cria a conta se ainda não existir; ao abrir o link
 * a pessoa entra, o acesso convidado é aplicado pelo banco e ela define a própria senha em Minha conta.
 */
export async function sendInviteLink(email: string): Promise<void> {
  if (!isSupabaseConfigured) throw new Error('Supabase não configurado.')
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/conta` },
  })
  if (error) throw new Error(error.message || 'Não foi possível enviar o convite.')
}
