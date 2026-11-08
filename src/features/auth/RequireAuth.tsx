import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './AuthProvider.tsx'
import type { AppRole } from '../permissions/permissions.ts'

/** Guarda de rota apenas para UX. A proteção real dos dados é RLS. */
export function RequireAuth({ children, role }: { children: ReactNode; role?: AppRole }) {
  const { loading, session, authz, authzError, recovering } = useAuth()
  const location = useLocation()

  if (loading) return <p className="p-6 text-sm text-ink/70">Carregando…</p>
  if (!session) {
    const from = location.pathname + location.search + location.hash
    return <Navigate to="/entrar" replace state={{ from }} />
  }
  // sessão aberta por link de recuperação: definir a senha antes de usar a conta
  if (recovering) return <Navigate to="/nova-senha" replace />
  if (role) {
    if (authzError) {
      return <p role="alert" className="p-6 text-danger">Não foi possível verificar suas permissões. Tente novamente.</p>
    }
    if (!authz?.roles.includes(role)) {
      return <p className="p-6 text-danger">Você não tem permissão para acessar esta área.</p>
    }
  }
  return <>{children}</>
}
