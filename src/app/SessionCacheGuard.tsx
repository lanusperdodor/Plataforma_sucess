import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useAuth } from '../features/auth/AuthProvider.tsx'

/**
 * Remove o cache pessoal e administrativo ao sair ou ao trocar de usuário, para que dados de
 * uma conta nunca apareçam para a próxima pessoa no mesmo aparelho.
 * Não toca na Sacola nem em outros dados do localStorage.
 */
export const PERSONAL_QUERY_ROOTS = ['me', 'admin', 'business', 'privacy'] as const

export function SessionCacheGuard() {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const userId = session?.user.id ?? null
  const previous = useRef<string | null>(userId)

  useEffect(() => {
    if (previous.current !== null && previous.current !== userId) {
      for (const key of PERSONAL_QUERY_ROOTS) queryClient.removeQueries({ queryKey: [key] })
    }
    previous.current = userId
  }, [userId, queryClient])

  return null
}
