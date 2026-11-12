import { isSupabaseConfigured, supabase } from '../../lib/supabase'

export type LiveTopic = 'orders' | 'notifications' | 'deliveries' | 'gestao' | 'resync'
export interface LiveNotification { id: string; kind: string; message: string | null; link: string | null }
export type LiveStatus = 'conectado' | 'reconectando' | 'falhou'

/**
 * Tempo real (Supabase Realtime): pedidos, entregas (equipe da loja) e notificações novas da própria conta.
 * O Realtime aplica as mesmas regras RLS das consultas: cada pessoa só recebe linhas que pode ler.
 * 'resync' avisa que o canal (re)conectou: quem ouve recarrega o estado do banco (cobre eventos perdidos).
 */
export function subscribeLiveUpdates(
  userId: string,
  onChange: (topic: LiveTopic, notification?: LiveNotification) => void,
  onStatus?: (s: LiveStatus, detail?: string) => void,
): () => void {
  if (!isSupabaseConfigured || !userId) return () => undefined
  const channel = supabase
    .channel(`live:${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (p) => {
      const n = (p as { new?: Record<string, unknown> }).new ?? {}
      onChange('notifications', { id: String(n.id ?? ''), kind: String(n.kind ?? ''), message: (n.message as string | null) ?? null, link: (n.link as string | null) ?? null })
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => onChange('orders'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, () => onChange('deliveries'))
    // Tucaí Gestão (0027): mesas, comandas, itens da cozinha e caixa — só chegam linhas que a equipe pode ler
    .on('postgres_changes', { event: '*', schema: 'public', table: 'business_tabs' }, () => onChange('gestao'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'business_tab_items' }, () => onChange('gestao'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'business_tables' }, () => onChange('gestao'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_sessions' }, () => onChange('gestao'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_movements' }, () => onChange('gestao'))
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') { onStatus?.('conectado'); onChange('resync') }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onStatus?.('falhou', err?.message ?? status)
      else if (status === 'CLOSED') onStatus?.('reconectando')
    })
  return () => {
    void supabase.removeChannel(channel)
  }
}
