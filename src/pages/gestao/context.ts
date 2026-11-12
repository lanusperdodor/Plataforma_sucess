import { createContext, useContext } from 'react'
import type { MerchantBusiness } from '../../features/merchant/repository.ts'
import type { BusinessPermission } from '../../features/permissions/permissions.ts'
import type { BusinessPlan } from '../../features/gestao/repository.ts'
import type { Niche } from './nav.ts'

export interface GestaoCtx {
  business: MerchantBusiness
  niche: Niche
  plan: BusinessPlan | undefined
  premium: boolean
  /** Só UX: a decisão real é do banco (RLS + RPCs com permissão e plano). */
  can: (p: BusinessPermission) => boolean
}

export const GestaoContext = createContext<GestaoCtx | null>(null)

export function useGestao(): GestaoCtx {
  const ctx = useContext(GestaoContext)
  if (!ctx) throw new Error('useGestao fora do Tucaí Gestão')
  return ctx
}
