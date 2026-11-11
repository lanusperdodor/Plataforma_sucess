import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useAuth } from '../auth/AuthProvider.tsx'
import { subscribeLiveUpdates, type LiveTopic } from './repository.ts'

/** Consultas afetadas por pedidos e notificações (cliente, estabelecimento, entregador e Master). */
export const LIVE_KEYS: Record<LiveTopic, readonly (readonly string[])[]> = {
  orders: [['orders'], ['merchant', 'orders'], ['merchant', 'deliveries'], ['courier'], ['admin', 'orders'], ['admin', 'order']],
  notifications: [['me', 'unread'], ['me', 'notifications'], ['courier', 'offers'], ['merchant', 'orders'], ['orders']],
  resync: [['orders'], ['merchant'], ['courier'], ['admin', 'orders'], ['admin', 'order'], ['me', 'unread'], ['me', 'notifications']],
}

/** Mantém os painéis atualizados sem recarregar a página. As consultas periódicas continuam como reserva. */
export function LiveUpdates() {
  const { session } = useAuth()
  const qc = useQueryClient()
  const userId = session?.user.id ?? ''
  useEffect(() => {
    if (!userId) return
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined
    const pending = new Set<LiveTopic>()
    const flush = () => {
      for (const topic of pending) for (const key of LIVE_KEYS[topic]) void qc.invalidateQueries({ queryKey: [...key] })
      pending.clear()
    }
    const off = subscribeLiveUpdates(userId, (topic) => {
      pending.add(topic)
      if (timer) globalThis.clearTimeout(timer)
      timer = globalThis.setTimeout(flush, 300)
    })
    return () => {
      if (timer) globalThis.clearTimeout(timer)
      off()
    }
  }, [userId, qc])
  return null
}
