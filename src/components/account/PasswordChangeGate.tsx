import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { mustChangePassword } from '../../features/account/repository.ts'
import { useAuth } from '../../features/auth/AuthProvider.tsx'

/** Conta com senha temporária (definida pelo suporte/Master) vai para Minha conta até trocar a senha. O banco guarda a obrigação. */
export function PasswordChangeGate() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const q = useQuery({ queryKey: ['me', 'must-change-password', userId], queryFn: mustChangePassword, enabled: !!userId, staleTime: 60_000 })
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (q.data && location.pathname !== '/conta') {
      navigate('/conta', { replace: true, state: { notice: 'Sua senha foi redefinida pelo suporte. Crie uma senha nova em "Alterar senha" para continuar.' } })
    }
  }, [q.data, location.pathname, navigate])
  return null
}
