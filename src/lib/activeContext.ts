import { useSyncExternalStore } from 'react'
import type { AuthContext } from '../features/permissions/permissions.ts'

/**
 * Perfil ativo de quem tem mais de um papel: comprar como cliente, operar uma loja, fazer entregas ou
 * supervisionar (Master). Só muda a navegação; cada tela e o banco continuam autorizando pelo papel real.
 */
export type ActiveContext = { kind: 'cliente' } | { kind: 'loja'; businessId: string } | { kind: 'entregador' } | { kind: 'master' }
const KEY = 'tucai:perfil'
const listeners = new Set<() => void>()

function read(): string {
  try { return localStorage.getItem(KEY) ?? 'cliente' } catch { return 'cliente' }
}
export function setActiveContext(c: ActiveContext) {
  const v = c.kind === 'loja' ? `loja:${c.businessId}` : c.kind
  try { localStorage.setItem(KEY, v) } catch { /* sem armazenamento */ }
  listeners.forEach((l) => l())
}
function subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l) }

/** Perfis que a conta realmente tem (cliente sempre). */
export function availableContexts(authz: AuthContext | null | undefined): ActiveContext[] {
  const out: ActiveContext[] = [{ kind: 'cliente' }]
  for (const m of authz?.memberships ?? []) out.push({ kind: 'loja', businessId: m.businessId })
  if (authz?.roles.includes('courier_partner')) out.push({ kind: 'entregador' })
  if (authz?.roles.includes('platform_master') || authz?.roles.includes('platform_operator')) out.push({ kind: 'master' })
  return out
}

/** Valida o perfil salvo contra os papéis atuais (perfil que a conta perdeu volta para cliente). */
export function resolveContext(raw: string, authz: AuthContext | null | undefined): ActiveContext {
  const ok = availableContexts(authz)
  if (raw.startsWith('loja:')) {
    const id = raw.slice(5)
    return ok.some((c) => c.kind === 'loja' && c.businessId === id) ? { kind: 'loja', businessId: id } : { kind: 'cliente' }
  }
  if (raw === 'entregador' || raw === 'master') return ok.some((c) => c.kind === raw) ? { kind: raw } : { kind: 'cliente' }
  return { kind: 'cliente' }
}

export function useActiveContext(authz: AuthContext | null | undefined): ActiveContext {
  const raw = useSyncExternalStore(subscribe, read, () => 'cliente')
  return resolveContext(raw, authz)
}

export function contextHome(c: ActiveContext): string {
  return c.kind === 'loja' ? `/painel/${c.businessId}/pedidos` : c.kind === 'entregador' ? '/entregador' : c.kind === 'master' ? '/admin' : '/'
}
