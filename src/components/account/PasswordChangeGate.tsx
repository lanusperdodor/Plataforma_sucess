import { useQuery } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { mustChangePassword } from '../../features/account/repository.ts'
import { useAuth } from '../../features/auth/AuthProvider.tsx'

const NOTICE = 'Sua senha foi redefinida pelo administrador. Para continuar, crie uma senha nova em "Alterar senha".'

/**
 * Conta com senha temporária (definida pelo suporte/Master) vai para Minha conta até trocar a senha. O banco guarda a
 * obrigação. Enquanto isso, uma faixa fixa explica o motivo em todas as telas (antes a pessoa ficava presa sem aviso).
 */
export function PasswordChangeGate() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const q = useQuery({ queryKey: ['me', 'must-change-password', userId], queryFn: mustChangePassword, enabled: !!userId, staleTime: 30_000 })
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (q.data && location.pathname !== '/conta') navigate('/conta', { replace: true, state: { notice: NOTICE } })
  }, [q.data, location.pathname, navigate])
  if (!q.data) return null
  return (
    <div role="alert" className="sticky top-0 z-[60] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-danger px-4 py-3 text-center text-sm font-semibold text-white">
      <KeyRound aria-hidden="true" className="size-5 shrink-0" />
      <span>{NOTICE}</span>
      <Link to="/conta#alterar-senha" className="rounded-full bg-white/20 px-3 py-1 underline">Criar senha nova</Link>
    </div>
  )
}
