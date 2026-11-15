/**
 * Tipo de conta escolhido ao criar a conta: cliente, entregador ou empresário. Só direciona o primeiro acesso
 * (entregador → cadastro de entregador; empresário → cadastro da empresa com plano e pagamento). Não dá permissão
 * nenhuma: os papéis reais vêm do banco depois do cadastro (entregador liberado na hora; empresa ao pagar o plano).
 */
export type AccountType = 'cliente' | 'entregador' | 'empresario'
const ACCOUNT_TYPE_KEY = 'tucai:tipo-conta'

export function saveAccountType(t: AccountType) {
  try { localStorage.setItem(ACCOUNT_TYPE_KEY, t) } catch { /* sem armazenamento */ }
}
export function readAccountType(meta?: Record<string, unknown> | null): AccountType | null {
  const m = meta?.account_type
  if (m === 'cliente' || m === 'entregador' || m === 'empresario') return m
  try {
    const v = localStorage.getItem(ACCOUNT_TYPE_KEY)
    return v === 'cliente' || v === 'entregador' || v === 'empresario' ? v : null
  } catch { return null }
}
export function clearAccountType() {
  try { localStorage.removeItem(ACCOUNT_TYPE_KEY) } catch { /* sem armazenamento */ }
}
/** Primeira tela de cada tipo. */
export const ONBOARDING_PATH: Record<AccountType, string> = { cliente: '/', entregador: '/entregadores', empresario: '/cadastrar-negocio' }
