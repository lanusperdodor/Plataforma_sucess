import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useAuth } from '../features/auth/AuthProvider.tsx'

/**
 * Remove o cache pessoal (`['me', ...]`) ao sair ou ao trocar de usuário.
 * Não toca na Sacola nem em outros dados do localStorage.
 */
export function SessionCacheGuard() {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const userId = session?.user.id ?? null
  const previous = useRef<string | null>(userId)

  useEffect(() => {
    if (previous.current !== null && previous.current !== userId) {
      queryClient.removeQueries({ queryKey: ['me'] })
    }
    previous.current = userId
  }, [userId, queryClient])

  return null
}
