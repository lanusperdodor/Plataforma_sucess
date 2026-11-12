import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Wrench } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthProvider.tsx'
import { getPlatformStatus, isMaintenanceError } from '../../features/platform/repository.ts'
import { MaintenancePage } from './MaintenancePage.tsx'

export const PLATFORM_STATUS_KEY = ['platform', 'status'] as const

/**
 * Mostra a página de manutenção a quem não é Master. É só a tela: o bloqueio real das gravações está no banco
 * (0030). O painel /admin continua acessível para o Master gerenciar e recuperar.
 */
export function MaintenanceGate({ children }: { children: ReactNode }) {
  const { authz } = useAuth()
  const { pathname } = useLocation()
  const q = useQuery({ queryKey: PLATFORM_STATUS_KEY, queryFn: getPlatformStatus, refetchInterval: 60_000, refetchOnWindowFocus: true, staleTime: 15_000 })
  const qc = useQueryClient()
  // uma gravação recusada pela manutenção atualiza o estado na hora (sem esperar a próxima consulta)
  useEffect(() => qc.getMutationCache().subscribe((ev) => {
    if (ev.type === 'updated' && ev.mutation.state.status === 'error' && isMaintenanceError(ev.mutation.state.error)) {
      void qc.invalidateQueries({ queryKey: PLATFORM_STATUS_KEY })
    }
  }), [qc])
  const mode = q.data?.mode ?? 'normal'
  const master = !!authz?.roles.includes('platform_master')
  const adminArea = pathname.startsWith('/admin')
  if (mode === 'manutencao' && !master && !adminArea) {
    return <MaintenancePage eta={q.data?.eta ?? null} onRetry={() => void q.refetch()} checking={q.isFetching} />
  }
  return (
    <>
      {mode !== 'normal' && (
        <div role="status" className="flex items-center justify-center gap-2 bg-ink px-4 py-2 text-center text-sm font-medium text-surface">
          <Wrench aria-hidden="true" className="size-4 shrink-0" />
          {mode === 'preparando'
            ? 'Manutenção programada: novos pedidos e alterações estão pausados. O que já está em andamento continua.'
            : 'Plataforma em manutenção (acesso Master).'}
        </div>
      )}
      {children}
    </>
  )
}
