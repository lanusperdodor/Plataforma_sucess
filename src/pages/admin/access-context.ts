import { createContext, useContext } from 'react'
import type { AdminAccess } from '../../features/admin/repository.ts'

export const AdminAccessContext = createContext<AdminAccess | null>(null)

export function useAdminAccess(): AdminAccess {
  const v = useContext(AdminAccessContext)
  if (!v) throw new Error('useAdminAccess deve ser usado dentro do Painel Master')
  return v
}
