import { isSupabaseConfigured, supabase } from '../../lib/supabase'

export type LiveTopic = 'orders' | 'notifications' | 'resync'

/**
 * Tempo real (Supabase Realtime, 0022): mudanças em pedidos e notificações novas da própria conta.
 * O Realtime aplica as mesmas regras RLS das consultas: cada pessoa só recebe linhas que pode ler
 * (cliente os seus pedidos, equipe os do estabelecimento, Master os da plataforma).
 * 'resync' avisa que o canal (re)conectou: quem ouve recarrega o estado, cobrindo quedas de conexão.
 */
export function subscribeLiveUpdates(userId: string, onChange: (topic: LiveTopic) => void): () => void {
  if (!isSupabaseConfigured || !userId) return () => undefined
  const channel = supabase
    .channel(`live:${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => onChange('notifications'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => onChange('orders'))
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onChange('resync')
    })
  return () => {
    void supabase.removeChannel(channel)
  }
}
