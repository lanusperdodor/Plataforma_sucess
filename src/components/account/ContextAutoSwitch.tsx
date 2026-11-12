import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthProvider.tsx'
import { setActiveContext } from '../../lib/activeContext.ts'

/** Entrar num painel (loja, entregador ou Master) passa a navegação para aquele perfil; voltar a comprar é pelo menu de conta. */
export function ContextAutoSwitch() {
  const { pathname } = useLocation()
  const { authz } = useAuth()
  useEffect(() => {
    if (!authz) return
    const loja = /^\/painel\/([0-9a-f-]{36})/.exec(pathname)?.[1]
    if (loja && authz.memberships.some((m) => m.businessId === loja)) setActiveContext({ kind: 'loja', businessId: loja })
    else if (pathname.startsWith('/entregador') && authz.roles.includes('courier_partner')) setActiveContext({ kind: 'entregador' })
    else if (pathname.startsWith('/admin') && (authz.roles.includes('platform_master') || authz.roles.includes('platform_operator'))) setActiveContext({ kind: 'master' })
  }, [pathname, authz])
  return null
}
