import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useToast } from '../../components/feedback/toast-context.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { subscribeLiveUpdates, type LiveNotification, type LiveTopic } from './repository.ts'

/** Consultas afetadas por pedidos, entregas e notificações (cliente, estabelecimento, entregador e Master). */
export const LIVE_KEYS: Record<LiveTopic, readonly (readonly string[])[]> = {
  orders: [['orders'], ['gestao'], ['merchant', 'orders'], ['merchant', 'deliveries'], ['courier'], ['admin', 'orders'], ['admin', 'order']],
  deliveries: [['merchant', 'deliveries'], ['merchant', 'orders'], ['orders'], ['courier'], ['admin', 'orders'], ['admin', 'order']],
  notifications: [['me', 'unread'], ['me', 'notifications'], ['courier'], ['merchant', 'orders'], ['merchant', 'deliveries'], ['orders']],
  gestao: [['gestao']],
  resync: [['orders'], ['gestao'], ['merchant'], ['courier'], ['admin', 'orders'], ['admin', 'order'], ['me', 'unread'], ['me', 'notifications']],
}

/** Alertas que tocam som: pedido novo para a loja, oferta para o entregador, mudança no pedido do cliente. */
const SOUND_KINDS = new Set(['order_new', 'delivery_offer', 'order_update', 'ops_alert'])
const SOUND_KEY = 'tucai:som'
/** Evento de janela para telas que mostram o alerta do seu jeito (ex.: Tucaí Gestão); preventDefault() dispensa o aviso padrão. */
export const LIVE_NOTIFICATION_EVENT = 'tucai:notificacao'

export function soundEnabled(): boolean {
  try { return localStorage.getItem(SOUND_KEY) !== 'off' } catch { return true }
}
export function setSoundEnabled(on: boolean) {
  try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off') } catch { /* sem armazenamento */ }
}

/** Bipe curto gerado no navegador (sem arquivo). O navegador só toca depois de alguma interação na página. */
export function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.4)
    osc.onended = () => void ctx.close()
  } catch {
    // áudio indisponível: o alerta visual continua
  }
}

/**
 * Mantém os painéis atualizados sem recarregar: Realtime invalida as consultas e o banco responde com o estado real.
 * Eventos repetidos são ignorados; ao reconectar ou voltar à aba, tudo é reconsultado; se o canal falhar,
 * as consultas periódicas das telas (15–30 s) seguem como reserva.
 */
export function LiveUpdates() {
  const { session } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const userId = session?.user.id ?? ''
  useEffect(() => {
    if (!userId) return
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined
    const pending = new Set<LiveTopic>()
    const seen = new Set<string>()
    const flush = () => {
      for (const topic of pending) for (const key of LIVE_KEYS[topic]) void qc.invalidateQueries({ queryKey: [...key] })
      pending.clear()
    }
    const onNotification = (n: LiveNotification) => {
      if (!n.id || seen.has(n.id)) return
      seen.add(n.id)
      if (n.message && SOUND_KINDS.has(n.kind)) {
        const handledElsewhere = !window.dispatchEvent(new CustomEvent<LiveNotification>(LIVE_NOTIFICATION_EVENT, { detail: n, cancelable: true }))
        if (!handledElsewhere) toast.success(n.message)
        if (soundEnabled() && document.visibilityState === 'visible') beep()
      }
    }
    const off = subscribeLiveUpdates(
      userId,
      (topic, n) => {
        if (n) onNotification(n)
        pending.add(topic)
        if (timer) globalThis.clearTimeout(timer)
        timer = globalThis.setTimeout(flush, 250)
      },
      (status, detail) => {
        if (status === 'falhou') console.warn('[tempo real] canal indisponível; usando atualização periódica.', detail ?? '')
      },
    )
    // voltar para a aba: reconsulta o banco (eventos perdidos enquanto estava em segundo plano)
    const onVisible = () => {
      if (document.visibilityState === 'visible') { pending.add('resync'); flush() }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (timer) globalThis.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      off()
    }
  }, [userId, qc, toast])
  return null
}
