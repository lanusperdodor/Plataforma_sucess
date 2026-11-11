import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/feedback/EmptyState.tsx'
import { ErrorState } from '../components/feedback/ErrorState.tsx'
import { LoginInvite } from '../components/feedback/LoginInvite.tsx'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import { listNotifications, markAllRead, type ConectaNotification } from '../features/conecta/repository.ts'
import { Avatar, relative } from './conecta/components.tsx'

function text(n: ConectaNotification): string {
  const who = n.actor?.displayName ?? 'Alguém'
  switch (n.kind) {
    case 'like': return `${who} curtiu sua publicação.`
    case 'comment': return `${who} comentou na sua publicação.`
    case 'reply': return `${who} respondeu ao seu comentário.`
    case 'follow': return n.message ? `${who} ${n.message}` : `${who} começou a seguir você.`
    default: return n.message ?? 'Aviso da moderação.'
  }
}

function href(n: ConectaNotification): string {
  if (n.postId) return `/conectuai/${n.postId}`
  if (n.kind === 'follow' && n.actor) return `/conectuai/u/${n.actor.handle}`
  return '/conectuai'
}

/** Notificações reais do Conectuaí (pedidos entram quando o módulo de pedidos existir). */
export function NotificationsPage() {
  const { session } = useAuth()
  const me = session?.user.id
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['me', 'notifications', me ?? ''], queryFn: () => listNotifications(me!), enabled: !!me })
  const read = useMutation({ mutationFn: () => markAllRead(me!), onSuccess: () => void qc.invalidateQueries({ queryKey: ['me', 'unread'] }) })
  const hasUnread = (q.data ?? []).some((n) => !n.read)
  useEffect(() => {
    // abrir a tela marca como lidas (depois de exibir o estado atual)
    if (hasUnread && read.isIdle) read.mutate()
  }, [hasUnread, read])
  return (
    <Page>
      <PageHeader icon={Bell} title="Notificações" subtitle="Interações no Conectuaí e avisos da moderação." />
      {!session ? (
        <LoginInvite icon={Bell} title="Receba avisos das suas interações" description="Entre para ver curtidas, comentários e novos seguidores." />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState icon={Bell} title={q.isLoading ? 'Carregando…' : 'Nenhuma notificação'} description="Quando alguém interagir com você, aparece aqui." />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {(q.data ?? []).map((n) => (
            <li key={n.id}>
              <Link to={href(n)} className="pressable flex min-h-16 items-start gap-3 p-4">
                <span aria-hidden="true" className={`mt-3 size-2 shrink-0 rounded-full ${n.read ? 'bg-line' : 'bg-orange'}`} />
                <Avatar profile={n.actor} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ink">{text(n)}{!n.read && <span className="sr-only"> (não lida)</span>}</span>
                  <span className="text-xs text-ink-muted">{relative(n.createdAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}
