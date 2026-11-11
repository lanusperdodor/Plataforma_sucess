import { RepositoryError, backendUnavailable } from '../../../lib/errors'
import { isSupabaseConfigured, supabase } from '../../../lib/supabase'

/**
 * MFA (TOTP) do Supabase Auth para a equipe administrativa.
 * A exigência real fica no banco: com `require_admin_mfa = true`, sem sessão aal2 nenhuma
 * permissão administrativa é reconhecida (ver 0005_platform_admin.sql).
 */

export interface MfaFactor {
  id: string
  friendlyName: string | null
  status: 'verified' | 'unverified'
}

export interface MfaStatus {
  factors: MfaFactor[]
  currentLevel: string | null
  nextLevel: string | null
}

export interface TotpEnrollment {
  factorId: string
  qrCode: string
  secret: string
}

function fail(message: string, cause?: unknown): never {
  throw new RepositoryError('unknown', message, undefined, { cause })
}

export async function getMfaStatus(): Promise<MfaStatus> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  const [factors, aal] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ])
  if (factors.error) fail('Não foi possível consultar seus fatores de autenticação.', factors.error)
  if (aal.error) fail('Não foi possível consultar o nível da sessão.', aal.error)
  return {
    factors: (factors.data?.all ?? [])
      .filter((f) => f.factor_type === 'totp')
      .map((f) => ({ id: f.id, friendlyName: f.friendly_name ?? null, status: f.status as MfaFactor['status'] })),
    currentLevel: aal.data?.currentLevel ?? null,
    nextLevel: aal.data?.nextLevel ?? null,
  }
}

export async function enrollTotp(): Promise<TotpEnrollment> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `Tucaí ${new Date().toISOString().slice(0, 10)}`,
  })
  if (error || !data) fail('Não foi possível iniciar o cadastro do autenticador.', error)
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }
}

export async function verifyTotp(factorId: string, code: string): Promise<void> {
  if (!/^\d{6}$/.test(code)) {
    throw new RepositoryError('validation', 'Digite os 6 números do aplicativo autenticador.')
  }
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
  if (error) fail('Código inválido ou expirado. Tente novamente.', error)
}

export async function removeFactor(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (error) fail('Não foi possível remover o fator.', error)
}
