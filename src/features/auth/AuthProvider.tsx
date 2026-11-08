import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../../lib/supabase.ts'
import type { AppRole, AuthContext, MemberRole } from '../permissions/permissions.ts'

interface AuthState {
  loading: boolean
  session: Session | null
  /** Contexto de autorização (somente UX; o banco decide de verdade). */
  authz: AuthContext | null
  /** Falha ao carregar papéis/vínculos; a UI não deve presumir "sem papéis". */
  authzError: boolean
  /** Sessão aberta por link de recuperação: o usuário precisa definir uma senha nova. */
  recovering: boolean
  finishRecovery: () => void
  signOut: () => Promise<{ error: boolean }>
}

const Ctx = createContext<AuthState | null>(null)

export async function loadAuthz(userId: string): Promise<AuthContext> {
  const [roles, members] = await Promise.all([
    supabase.from('user_roles').select('role').eq('user_id', userId),
    supabase.from('business_members').select('business_id, member_role').eq('user_id', userId),
  ])
  if (roles.error) throw roles.error
  if (members.error) throw members.error
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
  const [authzError, setAuthzError] = useState(false)
  const [recovering, setRecovering] = useState(false)
  // usuário da sessão mais recente; respostas de consultas de outro usuário são descartadas
  const currentUser = useRef<string | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      if (!next) {
        currentUser.current = null
        setRecovering(false)
        setAuthz(null)
        setAuthzError(false)
        setLoading(false)
        return
      }
      const userId = next.user.id
      // renovação de token do mesmo usuário não exige recarregar papéis
      if (currentUser.current === userId && event === 'TOKEN_REFRESHED') return
      if (currentUser.current !== userId) {
        currentUser.current = userId
        setAuthz(null) // nunca exibir papéis do usuário anterior
        setLoading(true)
      }
      // adia a consulta para fora do callback do Supabase (evita deadlock do cliente)
      setTimeout(() => {
        loadAuthz(userId)
          .then((a) => {
            if (currentUser.current !== userId) return
            setAuthz(a)
            setAuthzError(false)
          })
          .catch(() => {
            if (currentUser.current === userId) setAuthzError(true)
          })
          .finally(() => {
            if (currentUser.current === userId) setLoading(false)
          })
      }, 0)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const signOut = useCallback(async () => {
    // scope 'local' encerra a sessão deste dispositivo mesmo sem rede
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    return { error: Boolean(error) }
  }, [])

  const finishRecovery = useCallback(() => setRecovering(false), [])

  const value = useMemo(
    () => ({ loading, session, authz, authzError, recovering, finishRecovery, signOut }),
    [loading, session, authz, authzError, recovering, finishRecovery, signOut],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return v
}
