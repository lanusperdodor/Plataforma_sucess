import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PostMediaView } from './PostMediaView.tsx'
import { Bookmark, EyeOff, Flag, Heart, MessageCircle, MoreHorizontal, Pencil, Repeat2, Rocket, Share2, ShoppingBag, Store, Trash2, UserX } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { businessHref } from '../../components/cards/BusinessCard.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { Dialog } from '../../components/overlays/Dialog.tsx'
import { canInBusiness } from '../../features/permissions/permissions.ts'
import { useAuth } from '../../features/auth/AuthProvider.tsx'
import {
  REPORT_REASONS,
  addComment,
  appealModeration,
  createPost,
  deleteComment,
  deletePost,
  listComments,
  reportContent,
  setBlock,
  setLike,
  setSave,
  updatePost,
  type Comment,
  type Post,
  type ReportReason,
  type SocialProfile,
  type ReportTarget,
} from '../../features/conecta/repository.ts'
import { formatBRL } from '../../lib/money.ts'

export const btn = 'pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold disabled:opacity-50'
export const field = 'w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink'
export const errMsg = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Algo deu errado. Tente novamente.')

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })
const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' })
export function relative(iso: string, now = Date.now()): string {
  const s = Math.round((new Date(iso).getTime() - now) / 1000)
  const abs = Math.abs(s)
  if (abs < 60) return 'agora'
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  if (abs < 7 * 86400) return rtf.format(Math.round(s / 86400), 'day')
  return dateFmt.format(new Date(iso))
}

export function Avatar({ profile, size = 40 }: { profile: Pick<SocialProfile, 'displayName' | 'avatarUrl'> | null; size?: number }) {
  const initial = (profile?.displayName ?? '?').trim().charAt(0).toUpperCase()
  return profile?.avatarUrl ? (
    <img src={profile.avatarUrl} alt="" width={size} height={size} loading="lazy" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-full bg-brand font-bold text-orange" style={{ width: size, height: size }}>
      {initial}
    </span>
  )
}

/** Invalida tudo o que mostra publicações. */
export function useConectaRefresh() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: ['conecta'] })
}

// ---------- denúncia ----------
export function ReportDialog({ open, onClose, target }: { open: boolean; onClose: () => void; target: { type: ReportTarget; id: string } }) {
  const toast = useToast()
  const [reason, setReason] = useState<ReportReason>('harassment')
  const [details, setDetails] = useState('')
  const m = useMutation({
    mutationFn: () => reportContent(target.type, target.id, reason, details),
    onSuccess: () => {
      toast.success('Denúncia enviada. A equipe de moderação vai analisar.')
      setDetails('')
      onClose()
    },
    onError: (e) => toast.error(errMsg(e)),
  })
  return (
    <Dialog open={open} onClose={onClose} title="Denunciar">
      <form
        className="flex flex-col gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault()
          m.mutate()
        }}
      >
        <p className="text-sm text-ink-muted">Críticas e opiniões negativas são permitidas. Denuncie só o que viola as regras de convivência.</p>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium text-ink">Motivo</legend>
          {(Object.keys(REPORT_REASONS) as ReportReason[]).map((r) => (
            <label key={r} className="flex min-h-11 items-center gap-2 text-sm text-ink">
              <input type="radio" name="reason" className="size-5" checked={reason === r} onChange={() => setReason(r)} />
              {REPORT_REASONS[r]}
            </label>
          ))}
        </fieldset>
        <label htmlFor="rep-details" className="text-sm font-medium text-ink">Detalhes (opcional)</label>
        <textarea id="rep-details" maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} className={`${field} min-h-20 py-2`} />
        <button type="submit" disabled={m.isPending} className={`${btn} bg-brand text-surface`}>Enviar denúncia</button>
      </form>
    </Dialog>
  )
}

// ---------- contestação ----------
export function AppealForm({ type, id }: { type: 'post' | 'comment' | 'suspension'; id: string }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const m = useMutation({
    mutationFn: () => appealModeration(type, id, reason),
    onSuccess: () => {
      toast.success('Contestação enviada para revisão humana.')
      setOpen(false)
    },
    onError: (e) => toast.error(errMsg(e)),
  })
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-brand underline">Contestar decisão</button>
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        m.mutate()
      }}
    >
      <label htmlFor={`appeal-${id}`} className="text-sm font-medium text-ink">Por que a decisão deve ser revista?</label>
      <textarea id={`appeal-${id}`} minLength={10} maxLength={1000} required value={reason} onChange={(e) => setReason(e.target.value)} className={`${field} min-h-20 py-2`} />
      <button type="submit" disabled={m.isPending} className={`${btn} w-fit bg-brand text-surface`}>Enviar contestação</button>
    </form>
  )
}

// ---------- comentários ----------
function CommentItem({ c, post, me, onReply }: { c: Comment; post: Post; me: string | null; onReply?: (c: Comment) => void }) {
  const refresh = useConectaRefresh()
  const toast = useToast()
  const [reporting, setReporting] = useState(false)
  const del = useMutation({ mutationFn: () => deleteComment(c.id), onSuccess: refresh, onError: (e) => toast.error(errMsg(e)) })
  const canDelete = me && (c.authorId === me || post.authorId === me)
  return (
    <div className="flex gap-2">
      <Avatar profile={c.author} size={32} />
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl bg-muted px-3 py-2">
          <Link to={`/conectuai/u/${c.author?.handle ?? ''}`} className="text-sm font-semibold text-ink">{c.author?.displayName ?? 'Perfil indisponível'}</Link>
          {c.hidden ? (
            <p className="text-sm italic text-ink-muted">Comentário ocultado pela moderação.</p>
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm text-ink">{c.body}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 px-2 text-xs text-ink-muted">
          <span>{relative(c.createdAt)}{c.editedAt ? ' · editado' : ''}</span>
          {me && onReply && !c.hidden && <button type="button" onClick={() => onReply(c)} className="min-h-8 font-semibold">Responder</button>}
          {canDelete && <button type="button" onClick={() => del.mutate()} className="min-h-8 font-semibold">Excluir</button>}
          {me && c.authorId !== me && <button type="button" onClick={() => setReporting(true)} className="min-h-8 font-semibold">Denunciar</button>}
        </div>
        {c.hidden && c.authorId === me && <div className="px-2"><AppealForm type="comment" id={c.id} /></div>}
        {reporting && <ReportDialog open onClose={() => setReporting(false)} target={{ type: 'comment', id: c.id }} />}
      </div>
    </div>
  )
}

export function CommentThread({ post }: { post: Post }) {
  const { session } = useAuth()
  const me = session?.user.id ?? null
  const refresh = useConectaRefresh()
  const toast = useToast()
  const comments = useQuery({ queryKey: ['conecta', 'comments', post.id], queryFn: () => listComments(post.id) })
  const [body, setBody] = useState('')
  const [replyTo, setReplyTo] = useState<Comment | null>(null)
  const add = useMutation({
    mutationFn: () => addComment(post.id, body, replyTo?.id ?? null),
    onSuccess: () => {
      setBody('')
      setReplyTo(null)
      refresh()
    },
    onError: (e) => toast.error(errMsg(e)),
  })
  const all = comments.data ?? []
  const top = all.filter((c) => !c.parentId)
  return (
    <div className="flex flex-col gap-3 border-t border-line p-4">
      {comments.isError && <p role="alert" className="text-sm text-danger">{errMsg(comments.error)}</p>}
      {top.map((c) => (
        <div key={c.id} className="flex flex-col gap-2">
          <CommentItem c={c} post={post} me={me} onReply={setReplyTo} />
          <div className="ml-10 flex flex-col gap-2">
            {all.filter((r) => r.parentId === c.id).map((r) => <CommentItem key={r.id} c={r} post={post} me={me} />)}
          </div>
        </div>
      ))}
      {!comments.isLoading && top.length === 0 && <p className="text-sm text-ink-muted">Nenhum comentário ainda.</p>}
      {me ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (body.trim()) add.mutate()
          }}
        >
          {replyTo && (
            <p className="text-xs text-ink-muted">
              Respondendo a {replyTo.author?.displayName}{' '}
              <button type="button" onClick={() => setReplyTo(null)} className="font-semibold text-brand">cancelar</button>
            </p>
          )}
          <div className="flex gap-2">
            <label htmlFor={`c-${post.id}`} className="sr-only">Comentário</label>
            <textarea id={`c-${post.id}`} rows={1} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Escreva um comentário respeitoso…" className={`${field} min-h-11 flex-1 py-2.5`} />
            <button type="submit" disabled={add.isPending || !body.trim()} className={`${btn} bg-brand text-surface`}>Enviar</button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-ink-muted"><Link to="/entrar" className="font-semibold text-brand underline">Entre</Link> para comentar.</p>
      )}
    </div>
  )
}

// ---------- publicação ----------
function SharedPreview({ post }: { post: Omit<Post, 'shared'> }) {
  return (
    <Link to={`/conectuai/${post.id}`} className="block rounded-2xl border border-line p-3 hover:bg-muted">
      <p className="text-xs font-semibold text-ink">{post.business?.name ?? post.author?.displayName}</p>
      <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm text-ink">{post.body}</p>
    </Link>
  )
}

export function PostCard({ post, startOpen = false, sponsored = false }: { post: Post; startOpen?: boolean; sponsored?: boolean }) {
  const { session, authz } = useAuth()
  const me = session?.user.id ?? null
  const toast = useToast()
  const refresh = useConectaRefresh()
  const [showComments, setShowComments] = useState(startOpen)
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(post.body)
  const [reporting, setReporting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [shareText, setShareText] = useState('')
  const mine = me === post.authorId
  const needLogin = () => toast.info('Entre e crie seu perfil no Conectuaí para interagir.')

  const like = useMutation({ mutationFn: () => setLike(post.id, !post.likedByMe, me!), onSuccess: refresh, onError: (e) => toast.error(errMsg(e)) })
  const save = useMutation({ mutationFn: () => setSave(post.id, !post.savedByMe, me!), onSuccess: refresh, onError: (e) => toast.error(errMsg(e)) })
  const edit = useMutation({ mutationFn: () => updatePost(post.id, draft), onSuccess: () => { setEditing(false); refresh() }, onError: (e) => toast.error(errMsg(e)) })
  const remove = useMutation({ mutationFn: () => deletePost(post.id), onSuccess: () => { toast.success('Publicação excluída.'); refresh() }, onError: (e) => toast.error(errMsg(e)) })
  const block = useMutation({ mutationFn: () => setBlock(me!, post.authorId, true), onSuccess: () => { toast.success('Perfil bloqueado.'); refresh() }, onError: (e) => toast.error(errMsg(e)) })
  const repost = useMutation({
    mutationFn: () => createPost({ body: shareText, cityId: null, businessId: null, productId: null, sharedPostId: post.id }),
    onSuccess: () => { toast.success('Compartilhado no seu perfil.'); setSharing(false); setShareText(''); refresh() },
    onError: (e) => toast.error(errMsg(e)),
  })
  const copyLink = async () => {
    const url = `${window.location.origin}/conecta/${post.id}`
    try {
      if (navigator.share) await navigator.share({ url, title: 'Publicação no Conectuaí' })
      else {
        await navigator.clipboard.writeText(url)
        toast.success('Link copiado.')
      }
    } catch {
      // compartilhamento cancelado pelo usuário
    }
  }
  const action = 'pressable inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium'
  const authorName = post.business ? post.business.name : post.author?.displayName ?? 'Perfil indisponível'

  return (
    <article className="overflow-hidden rounded-card border border-line bg-surface" aria-label={`Publicação de ${authorName}`}>
      <header className="flex items-start gap-3 p-4 pb-2">
        {post.business ? (
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-orange"><Store className="size-5" /></span>
        ) : (
          <Avatar profile={post.author} />
        )}
        <div className="min-w-0 flex-1">
          {post.business ? (
            <Link to={businessHref(post.business)} className="block truncate text-sm font-semibold text-ink">{post.business.name}</Link>
          ) : (
            <Link to={`/conectuai/u/${post.author?.handle ?? ''}`} className="block truncate text-sm font-semibold text-ink">{authorName}</Link>
          )}
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
            {post.business && post.author && <span>por @{post.author.handle}</span>}
            {!post.business && post.author && <span>@{post.author.handle}</span>}
            <Link to={`/conectuai/${post.id}`} className="hover:underline">{relative(post.createdAt)}</Link>
            {post.editedAt && <span>· editado</span>}
            {(post.isSponsored || sponsored) && <span className="inline-flex items-center gap-0.5 font-semibold text-warm"><Rocket aria-hidden="true" className="size-3" />Patrocinado</span>}
          </p>
        </div>
        {me && (
          <div className="relative">
            <button type="button" aria-label="Mais opções" aria-expanded={menu} onClick={() => setMenu((v) => !v)} className="pressable inline-flex size-11 items-center justify-center rounded-full text-ink-muted">
              <MoreHorizontal aria-hidden="true" className="size-5" />
            </button>
            {menu && (
              <ul className="absolute right-0 z-10 mt-1 w-56 overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]" onClick={() => setMenu(false)}>
                {mine && !post.hidden && <li><button type="button" onClick={() => setEditing(true)} className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm text-ink hover:bg-muted"><Pencil aria-hidden="true" className="size-4" />Editar</button></li>}
                {mine && (
                  <li>
                    <button type="button" onClick={() => { if (window.confirm('Excluir esta publicação?')) remove.mutate() }} className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm text-danger hover:bg-muted">
                      <Trash2 aria-hidden="true" className="size-4" />Excluir
                    </button>
                  </li>
                )}
                {post.business && !post.hidden && canInBusiness(authz, 'store.customize', post.business.id) && (
                  <li><Link to={`/painel/${post.business.id}/anuncios?post=${post.id}`} className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm text-ink hover:bg-muted"><Rocket aria-hidden="true" className="size-4" />Turbinar publicação</Link></li>
                )}
                {!mine && <li><button type="button" onClick={() => setReporting(true)} className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm text-ink hover:bg-muted"><Flag aria-hidden="true" className="size-4" />Denunciar</button></li>}
                {!mine && (
                  <li>
                    <button type="button" onClick={() => { if (window.confirm('Bloquear este perfil? Vocês deixarão de ver e interagir com as publicações um do outro.')) block.mutate() }} className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm text-ink hover:bg-muted">
                      <UserX aria-hidden="true" className="size-4" />Bloquear perfil
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </header>

      <div className="flex flex-col gap-3 px-4 pb-2">
        {post.hidden && (
          <div className="flex flex-col gap-2 rounded-xl border border-line bg-warm-soft p-3 text-sm text-ink">
            <p className="inline-flex items-center gap-1.5 font-semibold"><EyeOff aria-hidden="true" className="size-4" />Ocultada pela moderação — só você vê.</p>
            {mine && <AppealForm type="post" id={post.id} />}
          </div>
        )}
        {editing ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              edit.mutate()
            }}
          >
            <label htmlFor={`edit-${post.id}`} className="sr-only">Editar publicação</label>
            <textarea id={`edit-${post.id}`} maxLength={2000} value={draft} onChange={(e) => setDraft(e.target.value)} className={`${field} min-h-24 py-2`} />
            <div className="flex gap-2">
              <button type="submit" disabled={edit.isPending || !draft.trim()} className={`${btn} bg-brand text-surface`}>Salvar</button>
              <button type="button" onClick={() => { setEditing(false); setDraft(post.body) }} className={`${btn} border border-line text-ink`}>Cancelar</button>
            </div>
          </form>
        ) : (
          <p className="whitespace-pre-wrap break-words text-[0.9375rem] leading-relaxed text-ink">{post.body}</p>
        )}
        {post.product && post.business && (
          <Link to={`${businessHref(post.business)}#produto-${post.product.id}`} className="flex items-center gap-3 rounded-2xl border border-line p-3 hover:bg-muted">
            <span aria-hidden="true" className="grid size-10 place-items-center rounded-xl bg-orange text-ink"><ShoppingBag className="size-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{post.product.name}</span>
              <span className="text-sm text-ink-muted">{formatBRL(post.product.priceCents)}{post.product.isAvailable ? '' : ' · indisponível'}</span>
            </span>
            <span className="text-sm font-semibold text-brand">Ver</span>
          </Link>
        )}
        <PostMediaView media={post.media} />
        {post.shared && <SharedPreview post={post.shared} />}
        {post.sharedUnavailable && <p className="rounded-2xl border border-dashed border-line p-3 text-sm text-ink-muted">Publicação original indisponível.</p>}
      </div>

      <footer className="flex flex-wrap items-center gap-1 px-2 pb-1">
        <button type="button" aria-pressed={post.likedByMe} aria-label={`Curtir (${post.likeCount})`} disabled={like.isPending || post.hidden} onClick={() => (me ? like.mutate() : needLogin())} className={`${action} ${post.likedByMe ? 'text-warm' : 'text-ink-muted'}`}>
          <Heart aria-hidden="true" className={`size-5 ${post.likedByMe ? 'fill-current' : ''}`} />{post.likeCount}
        </button>
        <button type="button" aria-expanded={showComments} aria-label={`Comentários (${post.commentCount})`} onClick={() => setShowComments((v) => !v)} className={`${action} text-ink-muted`}>
          <MessageCircle aria-hidden="true" className="size-5" />{post.commentCount}
        </button>
        <button type="button" aria-label="Compartilhar no Conectuaí" disabled={post.hidden} onClick={() => (me ? setSharing((v) => !v) : needLogin())} className={`${action} text-ink-muted`}>
          <Repeat2 aria-hidden="true" className="size-5" />
        </button>
        <button type="button" aria-label="Copiar ou enviar link" onClick={() => void copyLink()} className={`${action} text-ink-muted`}>
          <Share2 aria-hidden="true" className="size-5" />
        </button>
        <button type="button" aria-pressed={post.savedByMe} aria-label={post.savedByMe ? 'Remover dos salvos' : 'Salvar'} disabled={save.isPending} onClick={() => (me ? save.mutate() : needLogin())} className={`${action} ml-auto ${post.savedByMe ? 'text-ink' : 'text-ink-muted'}`}>
          <Bookmark aria-hidden="true" className={`size-5 ${post.savedByMe ? 'fill-current' : ''}`} />
        </button>
      </footer>
      {sharing && (
        <form
          className="flex flex-col gap-2 border-t border-line p-4"
          onSubmit={(e) => {
            e.preventDefault()
            repost.mutate()
          }}
        >
          <label htmlFor={`share-${post.id}`} className="text-sm font-medium text-ink">Compartilhar com um comentário</label>
          <textarea id={`share-${post.id}`} maxLength={2000} required value={shareText} onChange={(e) => setShareText(e.target.value)} className={`${field} min-h-20 py-2`} />
          <button type="submit" disabled={repost.isPending || !shareText.trim()} className={`${btn} w-fit bg-brand text-surface`}>Compartilhar</button>
        </form>
      )}
      {showComments && <CommentThread post={post} />}
      {reporting && <ReportDialog open onClose={() => setReporting(false)} target={{ type: 'post', id: post.id }} />}
    </article>
  )
}
