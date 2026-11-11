import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { LoginInvite } from '../../components/feedback/LoginInvite.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { Page, PageHeader } from '../../components/nav/PageHeader.tsx'
import { useAuth } from '../../features/auth/AuthProvider.tsx'
import { acceptFriend, decideTestimonial, listFriendRequests, listFriends, listTestimonials, removeFriend } from '../../features/conectuai/repository.ts'
import { useMySocialProfile } from '../ConectaPage.tsx'
import { Avatar, btn, errMsg, relative } from '../conecta/components.tsx'
import { ConectuaiNav } from './ConectuaiNav.tsx'

/** Convites de amizade, depoimentos aguardando aprovação e lista de amigos. */
export function FriendsPage() {
  const { session } = useAuth()
  const me = session?.user.id ?? null
  const profile = useMySocialProfile()
  const qc = useQueryClient()
  const toast = useToast()
  const refresh = () => void qc.invalidateQueries({ queryKey: ['conectuai'] })
  const requests = useQuery({ queryKey: ['conectuai', 'requests', me ?? ''], queryFn: () => listFriendRequests(me!), enabled: !!me && !!profile.data })
  const friends = useQuery({ queryKey: ['conectuai', 'friends', me ?? ''], queryFn: () => listFriends(me!), enabled: !!me && !!profile.data })
  const testimonials = useQuery({ queryKey: ['conectuai', 'testimonials', me ?? ''], queryFn: () => listTestimonials(me!), enabled: !!me && !!profile.data })
  const accept = useMutation({ mutationFn: (id: string) => acceptFriend(me!, id), onSuccess: refresh, onError: (e) => toast.error(errMsg(e)) })
  const decline = useMutation({ mutationFn: (id: string) => removeFriend(me!, id), onSuccess: refresh, onError: (e) => toast.error(errMsg(e)) })
  const decide = useMutation({ mutationFn: ({ id, ok }: { id: string; ok: boolean }) => decideTestimonial(id, ok), onSuccess: refresh, onError: (e) => toast.error(errMsg(e)) })
  const pendingTestimonials = (testimonials.data ?? []).filter((t) => t.status === 'pending')

  return (
    <Page>
      <PageHeader icon={UserPlus} title="Amigos" subtitle="Convites, depoimentos para aprovar e sua lista de amigos." />
      <ConectuaiNav />
      {!me ? (
        <LoginInvite icon={UserPlus} title="Entre para ver seus amigos" description="Faça amizades, troque recados e escreva depoimentos." />
      ) : profile.data === null ? (
        <EmptyState icon={UserPlus} title="Crie seu perfil no Conectuaí" action={<Link to="/conectuai" className={`${btn} bg-brand text-surface`}>Criar perfil</Link>} />
      ) : (
        <>
          {(requests.data ?? []).length > 0 && (
            <section aria-labelledby="convites" className="rounded-card border border-warm bg-surface p-4">
              <h2 id="convites" className="mb-2 text-sm font-semibold text-ink">Convites de amizade</h2>
              <ul className="flex flex-col gap-2">
                {(requests.data ?? []).map((p) => (
                  <li key={p.userId} className="flex flex-wrap items-center gap-2">
                    <Avatar profile={p} size={36} />
                    <Link to={`/conectuai/u/${p.handle}`} className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{p.displayName} <span className="font-normal text-ink-muted">@{p.handle}</span></Link>
                    <button type="button" onClick={() => accept.mutate(p.userId)} className={`${btn} bg-brand text-surface`}>Aceitar</button>
                    <button type="button" onClick={() => decline.mutate(p.userId)} className={`${btn} border border-line text-ink`}>Recusar</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {pendingTestimonials.length > 0 && (
            <section aria-labelledby="dep-pend" className="rounded-card border border-warm bg-surface p-4">
              <h2 id="dep-pend" className="mb-2 text-sm font-semibold text-ink">Depoimentos aguardando sua aprovação</h2>
              <p className="mb-2 text-xs text-ink-muted">Só aparecem no seu perfil depois que você aprovar.</p>
              <ul className="flex flex-col gap-3">
                {pendingTestimonials.map((t) => (
                  <li key={t.id} className="flex flex-col gap-2 rounded-xl border border-line p-3">
                    <p className="text-sm font-semibold text-ink">{t.author?.displayName ?? 'Perfil indisponível'} <span className="font-normal text-ink-muted">· {relative(t.createdAt)}</span></p>
                    <p className="whitespace-pre-wrap break-words text-sm text-ink">{t.body}</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => decide.mutate({ id: t.id, ok: true })} className={`${btn} bg-brand text-surface`}>Aprovar</button>
                      <button type="button" onClick={() => decide.mutate({ id: t.id, ok: false })} className={`${btn} border border-line text-ink`}>Recusar</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="lista-amigos" className="flex flex-col gap-3">
            <h2 id="lista-amigos" className="text-lg font-semibold text-ink">{(friends.data ?? []).length} {(friends.data ?? []).length === 1 ? 'amigo' : 'amigos'}</h2>
            {friends.isError ? (
              <ErrorState error={friends.error} onRetry={() => void friends.refetch()} />
            ) : (friends.data ?? []).length === 0 ? (
              <p className="text-sm text-ink-muted">{friends.isLoading ? 'Carregando…' : 'Abra o perfil de alguém e toque em “Adicionar amigo”.'}</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {(friends.data ?? []).map((p) => (
                  <li key={p.userId}>
                    <Link to={`/conectuai/u/${p.handle}`} className="hover-lift pressable flex flex-col items-center gap-2 rounded-card border border-line bg-surface p-3 text-center">
                      <Avatar profile={p} size={56} />
                      <span className="w-full truncate text-sm font-semibold text-ink">{p.displayName}</span>
                      <span className="w-full truncate text-xs text-ink-muted">@{p.handle}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Page>
  )
}
