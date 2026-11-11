import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserCheck, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import type { SocialProfile } from '../../features/conecta/repository.ts'
import {
  COMMUNITY_CATEGORIES,
  acceptFriend,
  addScrap,
  deleteScrap,
  deleteTestimonial,
  getFriendState,
  listFriends,
  listScraps,
  listTestimonials,
  myCommunities,
  removeFriend,
  sendFriendRequest,
  writeTestimonial,
  type Scrap,
} from '../../features/conectuai/repository.ts'
import { Avatar, ReportDialog, btn, errMsg, field, relative } from '../conecta/components.tsx'

const useRefresh = () => {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: ['conectuai'] })
}

/** Adicionar amigo / convite enviado / aceitar / desfazer amizade. */
export function FriendButton({ me, other }: { me: string; other: SocialProfile }) {
  const toast = useToast()
  const refresh = useRefresh()
  const state = useQuery({ queryKey: ['conectuai', 'friend-state', me, other.userId], queryFn: () => getFriendState(me, other.userId) })
  const m = useMutation({
    mutationFn: async () => {
      if (state.data === 'none') return sendFriendRequest(other.userId)
      if (state.data === 'received') return acceptFriend(me, other.userId)
      return removeFriend(me, other.userId)
    },
    onSuccess: refresh,
    onError: (e) => toast.error(errMsg(e)),
  })
  const s = state.data
  if (!s) return null
  const label = s === 'none' ? 'Adicionar amigo' : s === 'sent' ? 'Convite enviado · cancelar' : s === 'received' ? 'Aceitar amizade' : 'Amigos'
  return (
    <button
      type="button"
      disabled={m.isPending}
      onClick={() => {
        if (s === 'friends' && !window.confirm(`Desfazer amizade com ${other.displayName}?`)) return
        m.mutate()
      }}
      className={`${btn} ${s === 'none' || s === 'received' ? 'bg-brand text-surface' : 'border border-line text-ink'}`}
    >
      {s === 'friends' ? <UserCheck aria-hidden="true" className="size-4" /> : <UserPlus aria-hidden="true" className="size-4" />}
      {label}
    </button>
  )
}

function ScrapItem({ s, me, ownerId, onReply, replies }: { s: Scrap; me: string | null; ownerId: string; onReply?: (s: Scrap) => void; replies?: Scrap[] }) {
  const toast = useToast()
  const refresh = useRefresh()
  const [reporting, setReporting] = useState(false)
  const del = useMutation({ mutationFn: () => deleteScrap(s.id), onSuccess: refresh, onError: (e) => toast.error(errMsg(e)) })
  return (
    <li className="flex gap-3">
      <Avatar profile={s.author} size={36} />
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl bg-muted px-3 py-2">
          <Link to={`/conectuai/u/${s.author?.handle ?? ''}`} className="text-sm font-semibold text-ink">{s.author?.displayName ?? 'Perfil indisponível'}</Link>
          {s.hidden ? <p className="text-sm italic text-ink-muted">Recado ocultado pela moderação.</p> : <p className="whitespace-pre-wrap break-words text-sm text-ink">{s.body}</p>}
        </div>
        <div className="flex flex-wrap gap-3 px-2 text-xs font-semibold text-ink-muted">
          <span className="font-normal">{relative(s.createdAt)}</span>
          {onReply && me === ownerId && !s.hidden && <button type="button" className="min-h-8" onClick={() => onReply(s)}>Responder</button>}
          {me && (me === s.authorId || me === ownerId) && <button type="button" className="min-h-8" onClick={() => del.mutate()}>Excluir</button>}
          {me && me !== s.authorId && <button type="button" className="min-h-8" onClick={() => setReporting(true)}>Denunciar</button>}
        </div>
        {replies && replies.length > 0 && <ul className="mt-2 flex flex-col gap-2">{replies.map((r) => <ScrapItem key={r.id} s={r} me={me} ownerId={ownerId} />)}</ul>}
        {reporting && <ReportDialog open onClose={() => setReporting(false)} target={{ type: 'scrap', id: s.id }} />}
      </div>
    </li>
  )
}

/** Mural de recados, com respostas da dona/dono do perfil. */
export function ScrapWall({ owner, me, canWrite }: { owner: SocialProfile; me: string | null; canWrite: boolean }) {
  const toast = useToast()
  const refresh = useRefresh()
  const [body, setBody] = useState('')
  const [replyTo, setReplyTo] = useState<Scrap | null>(null)
  const q = useQuery({ queryKey: ['conectuai', 'scraps', owner.userId], queryFn: () => listScraps(owner.userId) })
  const add = useMutation({ mutationFn: () => addScrap(owner.userId, body, replyTo?.id ?? null), onSuccess: () => { setBody(''); setReplyTo(null); refresh() }, onError: (e) => toast.error(errMsg(e)) })
  if (!owner.wallEnabled && me !== owner.userId) return <p className="text-sm text-ink-muted">Este mural está desativado.</p>
  const all = q.data ?? []
  const top = all.filter((s) => !s.parentId)
  return (
    <div className="flex flex-col gap-4">
      {canWrite && (
        <form className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4" onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate() }}>
          <label htmlFor="recado" className="text-sm font-medium text-ink">{replyTo ? `Respondendo a ${replyTo.author?.displayName}` : me === owner.userId ? 'Escreva no seu mural' : `Deixe um recado para ${owner.displayName}`}</label>
          <textarea id="recado" maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} className={`${field} min-h-20 py-2`} />
          <div className="flex gap-2">
            <button type="submit" disabled={add.isPending || !body.trim()} className={`${btn} bg-brand text-surface`}>Enviar recado</button>
            {replyTo && <button type="button" onClick={() => setReplyTo(null)} className={`${btn} border border-line text-ink`}>Cancelar resposta</button>}
          </div>
        </form>
      )}
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : top.length === 0 ? (
        <p className="text-sm text-ink-muted">{q.isLoading ? 'Carregando…' : 'Nenhum recado ainda.'}</p>
      ) : (
        <ul className="flex flex-col gap-3">{top.map((s) => <ScrapItem key={s.id} s={s} me={me} ownerId={owner.userId} onReply={setReplyTo} replies={all.filter((r) => r.parentId === s.id)} />)}</ul>
      )}
    </div>
  )
}

/** Depoimentos aprovados; amigos podem escrever (vão para aprovação). */
export function Testimonials({ owner, me, isFriend }: { owner: SocialProfile; me: string | null; isFriend: boolean }) {
  const toast = useToast()
  const refresh = useRefresh()
  const [body, setBody] = useState('')
  const q = useQuery({ queryKey: ['conectuai', 'testimonials', owner.userId], queryFn: () => listTestimonials(owner.userId) })
  const write = useMutation({ mutationFn: () => writeTestimonial(owner.userId, body), onSuccess: () => { setBody(''); toast.success('Depoimento enviado. Ele aparece depois da aprovação.'); refresh() }, onError: (e) => toast.error(errMsg(e)) })
  const del = useMutation({ mutationFn: deleteTestimonial, onSuccess: refresh, onError: (e) => toast.error(errMsg(e)) })
  const list = q.data ?? []
  const approved = list.filter((t) => t.status === 'approved')
  const myOwn = list.find((t) => t.authorId === me)
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-ink-muted">Depoimentos são mensagens pessoais entre amigos. Não são avaliações de estabelecimentos.</p>
      {me && me !== owner.userId && isFriend && owner.testimonialsEnabled && !myOwn && (
        <form className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4" onSubmit={(e) => { e.preventDefault(); write.mutate() }}>
          <label htmlFor="dep" className="text-sm font-medium text-ink">Escreva um depoimento para {owner.displayName}</label>
          <textarea id="dep" minLength={10} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} className={`${field} min-h-24 py-2`} />
          <button type="submit" disabled={write.isPending || body.trim().length < 10} className={`${btn} w-fit bg-brand text-surface`}>Enviar para aprovação</button>
        </form>
      )}
      {myOwn && myOwn.status !== 'approved' && (
        <p className="text-sm text-ink-muted">Seu depoimento está {myOwn.status === 'pending' ? 'aguardando aprovação' : 'não publicado'}. <button type="button" className="font-semibold text-brand underline" onClick={() => del.mutate(myOwn.id)}>Excluir</button></p>
      )}
      {approved.length === 0 ? (
        <p className="text-sm text-ink-muted">{q.isLoading ? 'Carregando…' : 'Nenhum depoimento publicado.'}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {approved.map((t) => (
            <li key={t.id} className="flex gap-3 rounded-card border border-line bg-surface p-4">
              <Avatar profile={t.author} size={40} />
              <div className="min-w-0 flex-1">
                <Link to={`/conectuai/u/${t.author?.handle ?? ''}`} className="text-sm font-semibold text-ink">{t.author?.displayName ?? 'Perfil indisponível'}</Link>
                <p className="whitespace-pre-wrap break-words text-sm text-ink">{t.body}</p>
                {me && (me === t.authorId || me === owner.userId) && <button type="button" className="mt-1 text-xs font-semibold text-ink-muted" onClick={() => del.mutate(t.id)}>Excluir</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function FriendsGrid({ owner, me }: { owner: SocialProfile; me: string | null }) {
  const q = useQuery({ queryKey: ['conectuai', 'friends', owner.userId], queryFn: () => listFriends(owner.userId), enabled: owner.showConnections || me === owner.userId })
  if (!owner.showConnections && me !== owner.userId) return <p className="text-sm text-ink-muted">A lista de amigos é privada.</p>
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const list = q.data ?? []
  if (list.length === 0) return <p className="text-sm text-ink-muted">{q.isLoading ? 'Carregando…' : 'Nenhum amigo para mostrar.'}</p>
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      {list.map((p) => (
        <li key={p.userId}>
          <Link to={`/conectuai/u/${p.handle}`} className="pressable flex flex-col items-center gap-1 rounded-xl p-2 text-center hover:bg-muted">
            <Avatar profile={p} size={56} />
            <span className="w-full truncate text-xs font-semibold text-ink">{p.displayName}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export function CommunitiesGrid({ owner, me }: { owner: SocialProfile; me: string | null }) {
  const visible = owner.showConnections || me === owner.userId
  const q = useQuery({ queryKey: ['conectuai', 'my-communities', owner.userId], queryFn: () => myCommunities(owner.userId), enabled: visible })
  if (!visible) return <p className="text-sm text-ink-muted">As comunidades deste perfil são privadas.</p>
  const list = q.data ?? []
  if (list.length === 0) return <p className="text-sm text-ink-muted">{q.isLoading ? 'Carregando…' : 'Nenhuma comunidade.'}</p>
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {list.map((c) => (
        <li key={c.id}>
          <Link to={`/conectuai/c/${c.slug}`} className="pressable flex items-center gap-3 rounded-card border border-line bg-surface p-3 hover:bg-muted">
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand font-bold text-orange">{c.name.charAt(0).toUpperCase()}</span>
            <span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink">{c.name}</span><span className="text-xs text-ink-muted">{COMMUNITY_CATEGORIES[c.category]} · {c.memberCount} membros</span></span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
