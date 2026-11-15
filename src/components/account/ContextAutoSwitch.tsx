import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthProvider.tsx'
import { availableContexts, setActiveContext } from '../../lib/activeContext.ts'
import { ONBOARDING_PATH, clearAccountType, readAccountType } from '../../features/onboarding/accountType.ts'

/** Entrar num painel (loja, entregador ou Master) passa a navegação para aquele perfil; voltar a comprar é pelo menu de conta. */
export function ContextAutoSwitch() {
  const { pathname } = useLocation()
  const { authz, session } = useAuth()
  const navigate = useNavigate()
  // primeiro acesso: quem escolheu ser entregador ou empresário no cadastro vai para o cadastro correspondente
  useEffect(() => {
    if (!authz || !session) return
    const t = readAccountType(session.user.user_metadata as Record<string, unknown> | undefined)
    if (!t) return
    const done = t === 'cliente'
      || (t === 'entregador' && (authz.roles.includes('courier_partner') || authz.memberships.some((m) => m.role === 'courier_own')))
      || (t === 'empresario' && authz.memberships.some((m) => m.role !== 'courier_own'))
    if (done) { clearAccountType(); return }
    if (pathname === '/' || pathname === '/conta') navigate(ONBOARDING_PATH[t], { replace: true })
  }, [pathname, authz, session, navigate])
  // conta só de entregador: as telas de compra (o cadastro de entregador parceiro continua aberto ao entregador próprio) (início, explorar, pedidos, sacola…) levam às entregas
  useEffect(() => {
    if (!authz) return
    const ctxs = availableContexts(authz)
    if (ctxs.length !== 1 || ctxs[0]!.kind !== 'entregador') return
    const shop = pathname === '/' || /^\/(explorar|pedidos|sacola|restaurantes|lojas|servicos|vagas|busca|cadastrar-negocio)(\/|$)/.test(pathname)
    if (shop) navigate('/entregador', { replace: true })
  }, [pathname, authz, navigate])
  useEffect(() => {
    if (!authz) return
    const loja = /^\/painel\/([0-9a-f-]{36})/.exec(pathname)?.[1]
    if (loja && authz.memberships.some((m) => m.businessId === loja)) setActiveContext({ kind: 'loja', businessId: loja })
    else if (pathname.startsWith('/entregador') && (authz.roles.includes('courier_partner') || authz.memberships.some((m) => m.role === 'courier_own'))) setActiveContext({ kind: 'entregador' })
    else if (pathname.startsWith('/admin') && (authz.roles.includes('platform_master') || authz.roles.includes('platform_operator'))) setActiveContext({ kind: 'master' })
  }, [pathname, authz])
  return null
}
