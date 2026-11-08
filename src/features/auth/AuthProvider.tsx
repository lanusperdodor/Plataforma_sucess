import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../../lib/supabase.ts'
import type { AppRole, AuthContext, MemberRole } from '../permissions/permissions.ts'

interface AuthState {
  loading: boolean
  session: Session | null
  /** Contexto de autorização (somente UX; o banco decide de verdade). */
  authz: AuthContext | null
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

async function loadAuthz(userId: string): Promise<AuthContext> {
  const [roles, members] = await Promise.all([
    supabase.from('user_roles').select('role').eq('user_id', userId),
    supabase.from('business_members').select('business_id, member_role').eq('user_id', userId),
  ])
  return {
    userId,
    roles: (roles.data ?? []).map((r) => r.role as AppRole),
    memberships: (members.data ?? []).map((m) => ({
      businessId: m.business_id as string,
      role: m.member_role as MemberRole,
    })),
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [session, setSession] = useState<Session | null>(null)
  const [authz, setAuthz] = useState<AuthContext | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (!next) {
        setAuthz(null)
        setLoading(false)
        return
      }
      // adia a consulta para fora do callback do Supabase (evita deadlock do cliente)
      setTimeout(() => {
        loadAuthz(next.user.id)
          .then(setAuthz)
          .finally(() => setLoading(false))
      }, 0)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const value = useMemo(() => ({ loading, session, authz, signOut }), [loading, session, authz, signOut])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return v
}
