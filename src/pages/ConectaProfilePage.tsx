import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, Flag, Lock, MapPin, UserX } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ErrorState } from '../components/feedback/ErrorState.tsx'
import { NotFoundState } from '../components/feedback/NotFoundState.tsx'
import { useToast } from '../components/feedback/toast-context.ts'
import { Page } from '../components/nav/PageHeader.tsx'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import { answerFollowRequest, getFollowCounts, getFollowState, getProfileByHandle, listFollowRequests, setBlock, setFollow } from '../features/conecta/repository.ts'
import { useCurrentCity } from '../features/location/cityStore.ts'
import { Feed, ProfileSetup, useMySocialProfile } from './ConectaPage.tsx'
import { Avatar, ReportDialog, btn, errMsg, useConectaRefresh } from './conecta/components.tsx'
import { FilterChips } from '../components/nav/FilterChips.tsx'
import { getFriendState } from '../features/conectuai/repository.ts'
import { CommunitiesGrid, FriendButton, FriendsGrid, ScrapWall, Testimonials } from './conectuai/ProfileSections.tsx'

type ProfileTab = 'publicacoes' | 'recados' | 'depoimentos' | 'amigos' | 'comunidades'

/** Perfil social: dados escolhidos pela pessoa, seguidores e publicações (respeitando perfil fechado e bloqueios). */
export function ConectaProfilePage() {
  const { handle = '' } = useParams()
  const { session } = useAuth()
  const me = session?.user.id ?? null
  const myProfile = useMySocialProfile()
  const { cities } = useCurrentCity()
  const toast = useToast()
  const refresh = useConectaRefresh()
  const [editing, setEditing] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [tab, setTab] = useState<ProfileTab>('publicacoes')
  const profile = useQuery({ queryKey: ['conecta', 'profile', handle], queryFn: () => getProfileByHandle(handle) })
  const p = profile.data
  const counts = useQuery({ queryKey: ['conecta', 'counts', p?.userId ?? ''], queryFn: () => getFollowCounts(p!.userId), enabled: !!p })
  const state = useQuery({ queryKey: ['conecta', 'state', me ?? '', p?.userId ?? ''], queryFn: () => getFollowState(me!, p!.userId), enabled: !!me && !!p && p.userId !== me })
  const follow = useMutation({ mutationFn: () => setFollow(me!, p!.userId, !(state.data?.following || state.data?.pending)), onSuccess: refresh, onError: (e) => toast.error(errMsg(e)) })
  const requests = useQuery({ queryKey: ['conecta', 'requests', me ?? ''], queryFn: () => listFollowRequests(me!), enabled: !!me && !!p && p.userId === me })
  const answer = useMutation({ mutationFn: ({ id, ok }: { id: string; ok: boolean }) => answerFollowRequest(me!, id, ok), onSuccess: refresh, onError: (e) => toast.error(errMsg(e)) })
  const friendState = useQuery({ queryKey: ['conectuai', 'friend-state', me ?? '', p?.userId ?? ''], queryFn: () => getFriendState(me!, p!.userId), enabled: !!me && !!p && p.userId !== me })
  const block = useMutation({ mutationFn: () => setBlock(me!, p!.userId, !state.data?.blocked), onSuccess: refresh, onError: (e) => toast.error(errMsg(e)) })

  if (profile.isLoading) return <Page><p role="status" className="text-sm text-ink-muted">Carregando…</p></Page>
  if (profile.isError) return <Page><ErrorState error={profile.error} onRetry={() => void profile.refetch()} /></Page>
  if (!p) return <Page><NotFoundState title="Perfil não encontrado" description="O perfil não existe ou não está disponível para você." /></Page>
  const mine = me === p.userId
  const cityName = cities.find((c) => c.id === p.cityId)?.name
  const canSeePosts = p.isPublic || mine || state.data?.following
  const isFriend = friendState.data === 'friends'
  const canWriteWall = !!me && !!myProfile.data && (mine || (p.wallEnabled && (p.wallAudience === 'everyone' || isFriend)))

  return (
    <Page>
      <Link to="/conectuai" className="pressable inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-ink"><ArrowLeft aria-hidden="true" className="size-4" />Conectuaí</Link>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        {editing && myProfile.data ? (
          <ProfileSetup existing={myProfile.data} onDone={() => setEditing(false)} />
        ) : (
          <header className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 md:p-6">
            <div className="flex items-center gap-4">
              <Avatar profile={p} size={72} />
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-bold text-ink">{p.displayName}</h1>
                <p className="text-sm text-ink-muted">@{p.handle}{!p.isPublic && <span className="ml-2 inline-flex items-center gap-0.5"><Lock aria-hidden="true" className="size-3" />Perfil fechado</span>}</p>
              </div>
            </div>
            {p.bio && <p className="whitespace-pre-wrap break-words text-sm text-ink">{p.bio}</p>}
            <p className="flex flex-wrap gap-x-4 text-sm text-ink-muted">
              {cityName && <span className="inline-flex items-center gap-1"><MapPin aria-hidden="true" className="size-4" />{cityName}</span>}
              {counts.data && <span><strong className="text-ink">{counts.data.followers}</strong> seguidores · <strong className="text-ink">{counts.data.following}</strong> seguindo</span>}
            </p>
            <div className="flex flex-wrap gap-2">
              {mine ? (
                <button type="button" onClick={() => setEditing(true)} className={`${btn} border border-line text-ink`}>Editar perfil</button>
              ) : me && myProfile.data ? (
                <>
                  {!state.data?.blocked && <FriendButton me={me} other={p} />}
                  {!state.data?.blocked && (
                    <button type="button" onClick={() => follow.mutate()} disabled={follow.isPending} className={`${btn} ${state.data?.following || state.data?.pending ? 'border border-line text-ink' : 'bg-brand text-surface'}`}>
                      {state.data?.following ? 'Seguindo' : state.data?.pending ? 'Solicitado' : p.isPublic ? 'Seguir' : 'Pedir para seguir'}
                    </button>
                  )}
                  <button type="button" onClick={() => { if (state.data?.blocked || window.confirm(`Bloquear @${p.handle}?`)) block.mutate() }} className={`${btn} border border-line text-ink`}>
                    <UserX aria-hidden="true" className="size-4" />{state.data?.blocked ? 'Desbloquear' : 'Bloquear'}
                  </button>
                  <button type="button" onClick={() => setReporting(true)} className={`${btn} border border-line text-ink`}><Flag aria-hidden="true" className="size-4" />Denunciar</button>
                </>
              ) : me ? (
                <Link to="/conectuai" className={`${btn} bg-brand text-surface`}>Crie seu perfil para seguir</Link>
              ) : (
                <Link to="/entrar" className={`${btn} bg-brand text-surface`}>Entre para seguir</Link>
              )}
            </div>
          </header>
        )}
        {mine && (requests.data ?? []).length > 0 && (
          <section aria-labelledby="pedidos-seguir" className="rounded-card border border-line bg-surface p-4">
            <h2 id="pedidos-seguir" className="mb-2 text-sm font-semibold text-ink">Pedidos para seguir você</h2>
            <ul className="flex flex-col gap-2">
              {(requests.data ?? []).map((r) => (
                <li key={r.userId} className="flex flex-wrap items-center gap-2">
                  <Avatar profile={r} size={32} />
                  <Link to={`/conectuai/u/${r.handle}`} className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{r.displayName} <span className="font-normal text-ink-muted">@{r.handle}</span></Link>
                  <button type="button" onClick={() => answer.mutate({ id: r.userId, ok: true })} className={`${btn} bg-brand text-surface`}>Aprovar</button>
                  <button type="button" onClick={() => answer.mutate({ id: r.userId, ok: false })} className={`${btn} border border-line text-ink`}>Recusar</button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <FilterChips
          label="Seções do perfil"
          options={[
            { value: 'publicacoes', label: 'Publicações' },
            { value: 'recados', label: 'Recados' },
            { value: 'depoimentos', label: 'Depoimentos' },
            { value: 'amigos', label: 'Amigos' },
            { value: 'comunidades', label: 'Comunidades' },
          ]}
          value={tab}
          onChange={(v) => setTab(v as ProfileTab)}
        />
        {tab === 'publicacoes' ? (
          canSeePosts ? (
            <Feed scope={{ kind: 'author', userId: p.userId }} me={me} empty={{ title: 'Nenhuma publicação ainda', description: mine ? 'Suas publicações aparecem aqui.' : 'Este perfil ainda não publicou.' }} />
          ) : (
            <p className="rounded-card border border-line bg-surface p-4 text-sm text-ink-muted">Perfil fechado: siga para ver as publicações.</p>
          )
        ) : tab === 'recados' ? (
          <ScrapWall owner={p} me={me} canWrite={canWriteWall} />
        ) : tab === 'depoimentos' ? (
          <Testimonials owner={p} me={me} isFriend={isFriend} />
        ) : tab === 'amigos' ? (
          <FriendsGrid owner={p} me={me} />
        ) : (
          <CommunitiesGrid owner={p} me={me} />
        )}
      </div>
      {reporting && <ReportDialog open onClose={() => setReporting(false)} target={{ type: 'profile', id: p.userId }} />}
    </Page>
  )
}
