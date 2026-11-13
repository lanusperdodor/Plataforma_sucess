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

/** Texto de cada tipo. A mensagem gravada pelo banco tem prioridade quando existe (pedidos, entregas, vagas, avisos). */
export function notificationText(n: ConectaNotification): string {
  const who = n.actor?.displayName ?? 'Alguém'
  switch (n.kind) {
    case 'like': return `${who} curtiu sua publicação.`
    case 'comment': return `${who} comentou na sua publicação.`
    case 'reply': return `${who} respondeu ao seu comentário.`
    case 'follow': return n.message ? `${who} ${n.message}` : `${who} começou a seguir você.`
    case 'friend_request': return n.message ?? `${who} quer ser seu amigo.`
    case 'friend_accept': return n.message ?? `${who} aceitou sua amizade.`
    case 'scrap': return n.message ?? `${who} deixou um recado para você.`
    case 'testimonial': return n.message ?? `${who} escreveu um depoimento para você.`
    case 'community_request': return n.message ?? `${who} pediu para entrar na sua comunidade.`
    case 'community_accept': return n.message ?? 'Seu pedido para entrar na comunidade foi aceito.'
    case 'topic_reply': return n.message ?? `${who} respondeu a um tópico que você participa.`
    case 'moderation': return n.message ?? 'Aviso da moderação.'
    default: return n.message ?? 'Novo aviso da Tucaí.'
  }
}

/** Destino ao tocar: o link gravado pelo banco (já validado por restrição) ou o destino natural do tipo. */
export function notificationHref(n: ConectaNotification): string {
  if (n.link && n.link.startsWith('/')) return n.link
  if (n.postId) return `/conectuai/${n.postId}`
  if ((n.kind === 'follow' || n.kind === 'friend_accept' || n.kind === 'scrap' || n.kind === 'testimonial') && n.actor) return `/conectuai/u/${n.actor.handle}`
  if (n.kind === 'friend_request') return '/conectuai/amigos'
  if (n.kind === 'order_new' || n.kind === 'order_update') return '/pedidos'
  if (n.kind === 'delivery_offer') return '/entregador'
  if (n.kind === 'job_application' || n.kind === 'job_update') return '/vagas'
  return '/conectuai'
}

function ListSkeleton() {
  return (
    <ul aria-hidden="true" className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="flex items-start gap-3 p-4">
          <span className="size-9 shrink-0 animate-pulse rounded-full bg-muted" />
          <span className="flex flex-1 flex-col gap-2"><span className="h-3.5 w-3/4 animate-pulse rounded bg-muted" /><span className="h-3 w-1/4 animate-pulse rounded bg-muted" /></span>
        </li>
      ))}
    </ul>
  )
}

/** Notificações da conta: Conectuaí, amizades, recados, comunidades, pedidos, entregas, vagas e avisos. */
export function NotificationsPage() {
  const { session } = useAuth()
  const me = session?.user.id
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['me', 'notifications', me ?? ''], queryFn: () => listNotifications(me!), enabled: !!me })
  const read = useMutation({
    mutationFn: () => markAllRead(me!),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['me', 'unread'] }) },
  })
  const hasUnread = (q.data ?? []).some((n) => !n.read)
  useEffect(() => {
    // abrir a tela marca como lidas (a lista exibida mantém o destaque do que era novo)
    if (hasUnread && read.isIdle) read.mutate()
  }, [hasUnread, read])
  return (
    <Page>
      <PageHeader icon={Bell} title="Notificações" subtitle="Interações, amizades, comunidades, pedidos e avisos da Tucaí." />
      {!session ? (
        <LoginInvite icon={Bell} title="Receba avisos das suas interações" description="Entre para ver curtidas, comentários, amizades e o andamento dos pedidos." />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isLoading ? (
        <>
          <p role="status" className="sr-only">Carregando notificações…</p>
          <ListSkeleton />
        </>
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState icon={Bell} title="Nenhuma notificação" description="Quando alguém interagir com você ou um pedido mudar de etapa, aparece aqui." />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {(q.data ?? []).map((n) => (
            <li key={n.id}>
              <Link to={notificationHref(n)} className="pressable flex min-h-16 items-start gap-3 p-4">
                <span aria-hidden="true" className={`mt-3 size-2 shrink-0 rounded-full ${n.read ? 'bg-line' : 'bg-orange'}`} />
                <Avatar profile={n.actor} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ink">{notificationText(n)}{!n.read && <span className="sr-only"> (não lida)</span>}</span>
                  <span className="text-xs text-ink-muted">{relative(n.createdAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {read.isError && <p role="alert" className="text-sm text-danger">Não foi possível marcar como lidas agora. Elas continuam destacadas.</p>}
    </Page>
  )
}
