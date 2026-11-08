import { createContext, useContext } from 'react'

export type ToastKind = 'success' | 'info' | 'error'

export interface ToastApi {
  /** Mostra um toast e devolve o id. Sucesso/info: 5 s; erro: 8 s. */
  show: (kind: ToastKind, message: string) => number
  success: (message: string) => number
  info: (message: string) => number
  error: (message: string) => number
  dismiss: (id: number) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast deve ser usado dentro de <ToastProvider>')
  return ctx
}
