import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Lock, LockOpen, Pin, Plus, Search, ShieldCheck, Users } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { LoginInvite } from '../../components/feedback/LoginInvite.tsx'
import { NotFoundState } from '../../components/feedback/NotFoundState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { FilterChips } from '../../components/nav/FilterChips.tsx'
import { Page, PageHeader } from '../../components/nav/PageHeader.tsx'
import { useAuth } from '../../features/auth/AuthProvider.tsx'
import {
  COMMUNITY_CATEGORIES,
  addReply,
  communityFormSchema,
  createCommunity,
  createPoll,
  createTopic,
  deleteReply,
  getCommunity,
  getMembership,
  getTopic,
  joinCommunity,
  leaveCommunity,
  listCommunities,
  listMembers,
  listPolls,
  listReplies,
  listTopics,
  manageMember,
  moderateCommunityContent,
  myCommunities,
  setTopicFlags,
  topicFormSchema,
  updateCommunity,
  vote,
  type Community,
  type CommunityCategory,
  type CommunityForm,
  type Member,
  type Poll,
  type Topic,
} from '../../features/conectuai/repository.ts'
import { useCurrentCity } from '../../features/location/cityStore.ts'
import { useMySocialProfile } from '../ConectaPage.tsx'
import { Avatar, ReportDialog, btn, errMsg, field, relative } from '../conecta/components.tsx'
import { ConectuaiNav } from './ConectuaiNav.tsx'

const refreshKeys = (qc: ReturnType<typeof useQueryClient>) => void qc.invalidateQueries({ queryKey: ['conectuai'] })

function CommunityBadge({ c, size = 48 }: { c: Pick<Community, 'name' | 'avatarUrl'>; size?: number }) {
  return c.avatarUrl ? (
    <img src={c.avatarUrl} alt="" width={size} height={size} loading="lazy" className="shrink-0 rounded-xl object-cover" style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-xl bg-brand text-lg font-bold text-orange" style={{ width: size, height: size }}>
      {c.name.trim().charAt(0).toUpperCase()}
    </span>
  )
}

function CommunityCard({ c }: { c: Community }) {
  return (
    <Link to={`/conectuai/c/${c.slug}`} className="hover-lift pressable flex h-full gap-3 rounded-card border border-line bg-surface p-4">
      <CommunityBadge c={c} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 font-semibold text-ink">
          <span className="truncate">{c.name}</span>
          {c.isPrivate && <Lock aria-label="Comunidade fechada" className="size-3.5 shrink-0 text-ink-muted" />}
        </span>
        <span className="block text-xs text-ink-muted">{COMMUNITY_CATEGORIES[c.category]} · {c.memberCount} {c.memberCount === 1 ? 'membro' : 'membros'}</span>
        {c.description && <span className="mt-1 line-clamp-2 block text-sm text-ink-muted">{c.description}</span>}
      </span>
    </Link>
  )
}

function CommunityFormView({ existing, onDone }: { existing?: Community; onDone: (slug: string) => void }) {
  const { cities, city } = useCurrentCity()
  const qc = useQueryClient()
  const toast = useToast()
  const [v, setV] = useState<CommunityForm>({
    name: existing?.name ?? '',
    description: existing?.description ?? '',
    rules: existing?.rules ?? '',
    category: existing?.category ?? 'cidade',
    cityId: existing?.cityId ?? city?.id ?? '',
    isPrivate: existing?.isPrivate ?? false,
    avatarUrl: existing?.avatarUrl ?? '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const save = useMutation({
    mutationFn: async () => (existing ? (await updateCommunity(existing.id, v), existing.slug) : createCommunity(v)),
    onSuccess: (slug) => {
      toast.success(existing ? 'Comunidade atualizada.' : 'Comunidade criada.')
      refreshKeys(qc)
      onDone(slug)
    },
    onError: (e) => toast.error(errMsg(e)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const parsed = communityFormSchema.safeParse(v)
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])))
    setErrors({})
    save.mutate()
  }
  const set = <K extends keyof CommunityForm>(k: K, val: CommunityForm[K]) => setV((p) => ({ ...p, [k]: val }))
  const err = (k: string) => (errors[k] ? <p role="alert" className="mt-1 text-xs text-danger">{errors[k]}</p> : null)
  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-3 rounded-card border border-line bg-surface p-4 md:grid-cols-2 md:p-6">
      <h2 className="text-lg font-semibold text-ink md:col-span-2">{existing ? 'Configurações da comunidade' : 'Nova comunidade'}</h2>
      {!existing && (
        <div className="md:col-span-2">
          <label htmlFor="cm-nome" className="mb-1 block text-sm font-medium text-ink">Nome</label>
          <input id="cm-nome" maxLength={80} value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex.: Gastronomia de Itaú de Minas" className={`${field} min-h-11`} />
          {err('name')}
        </div>
      )}
      <div>
        <label htmlFor="cm-cat" className="mb-1 block text-sm font-medium text-ink">Categoria</label>
        <select id="cm-cat" value={v.category} onChange={(e) => set('category', e.target.value as CommunityCategory)} className={`${field} min-h-11`}>
          {(Object.keys(COMMUNITY_CATEGORIES) as CommunityCategory[]).map((k) => <option key={k} value={k}>{COMMUNITY_CATEGORIES[k]}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="cm-cidade" className="mb-1 block text-sm font-medium text-ink">Cidade ou região</label>
        <select id="cm-cidade" value={v.cityId} onChange={(e) => set('cityId', e.target.value)} className={`${field} min-h-11`}>
          <option value="">Toda a região</option>
          {cities.map((c) => <option key={c.id} value={c.id}>{c.name}, {c.state}</option>)}
        </select>
      </div>
      <div className="md:col-span-2">
        <label htmlFor="cm-desc" className="mb-1 block text-sm font-medium text-ink">Descrição</label>
        <textarea id="cm-desc" maxLength={1000} value={v.description} onChange={(e) => set('description', e.target.value)} className={`${field} min-h-20 py-2`} />
      </div>
      <div className="md:col-span-2">
        <label htmlFor="cm-regras" className="mb-1 block text-sm font-medium text-ink">Regras da comunidade</label>
        <textarea id="cm-regras" maxLength={3000} value={v.rules} onChange={(e) => set('rules', e.target.value)} placeholder="Ex.: Sem spam. Respeito com todos. Divulgação só às sextas." className={`${field} min-h-20 py-2`} />
      </div>
      <div>
        <label htmlFor="cm-foto" className="mb-1 block text-sm font-medium text-ink">Foto (endereço https, opcional)</label>
        <input id="cm-foto" inputMode="url" value={v.avatarUrl} onChange={(e) => set('avatarUrl', e.target.value)} className={`${field} min-h-11`} />
        {err('avatarUrl')}
      </div>
      <label className="flex min-h-11 items-start gap-2 self-end text-sm text-ink">
        <input type="checkbox" className="mt-0.5 size-5" checked={v.isPrivate} onChange={(e) => set('isPrivate', e.target.checked)} />
        <span>Comunidade fechada <span className="block text-ink-muted">Moderadores aprovam a entrada; o conteúdo fica visível só para membros.</span></span>
      </label>
      <div className="md:col-span-2">
        <button type="submit" disabled={save.isPending} className={`${btn} bg-brand text-surface`}>{save.isPending ? 'Salvando…' : existing ? 'Salvar' : 'Criar comunidade'}</button>
      </div>
    </form>
  )
}

/** Descoberta, busca e criação de comunidades. */
export function CommunitiesPage() {
  const { session } = useAuth()
  const me = session?.user.id ?? null
  const profile = useMySocialProfile()
  const navigate = useNavigate()
  const { city } = useCurrentCity()
  const [term, setTerm] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<'' | CommunityCategory>('')
  const [onlyCity, setOnlyCity] = useState(false)
  const [creating, setCreating] = useState(false)
  const list = useQuery({
    queryKey: ['conectuai', 'communities', search, category, onlyCity ? city?.id ?? '' : ''],
    queryFn: () => listCommunities({ search, category: category || undefined, cityId: onlyCity ? city?.id : null }),
  })
  const mine = useQuery({ queryKey: ['conectuai', 'my-communities', me ?? ''], queryFn: () => myCommunities(me!), enabled: !!me })
  return (
    <Page>
      <PageHeader icon={Users} title="Comunidades" subtitle="Grupos de interesse da região, com tópicos, enquetes e moderação própria." actions={me && profile.data && !creating ? <button type="button" onClick={() => setCreating(true)} className={`${btn} bg-brand text-surface`}><Plus aria-hidden="true" className="size-4" />Criar</button> : undefined} />
      <ConectuaiNav />
      {creating && <CommunityFormView onDone={(slug) => navigate(`/conectuai/c/${slug}`)} />}
      {me && profile.data === null && <p className="rounded-card border border-line bg-surface p-3 text-sm text-ink">Para criar ou entrar em comunidades, <Link to="/conectuai" className="font-semibold text-brand underline">crie seu perfil no Conectuaí</Link>.</p>}
      {(mine.data ?? []).length > 0 && (
        <section aria-labelledby="minhas-com" className="flex flex-col gap-3">
          <h2 id="minhas-com" className="text-lg font-semibold text-ink">Minhas comunidades</h2>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">{(mine.data ?? []).map((c) => <li key={c.id}><CommunityCard c={c} /></li>)}</ul>
        </section>
      )}
      <section aria-labelledby="descobrir-com" className="flex flex-col gap-3">
        <h2 id="descobrir-com" className="text-lg font-semibold text-ink">Descobrir</h2>
        <form role="search" onSubmit={(e) => { e.preventDefault(); setSearch(term) }} className="flex max-w-lg gap-2">
          <label htmlFor="com-busca" className="sr-only">Buscar comunidades</label>
          <input id="com-busca" type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Buscar por nome" className={`${field} min-h-11`} />
          <button type="submit" aria-label="Buscar" className={`${btn} border border-line text-ink`}><Search aria-hidden="true" className="size-4" /></button>
        </form>
        <FilterChips
          label="Categoria"
          options={[{ value: '' as const, label: 'Todas' }, ...(Object.keys(COMMUNITY_CATEGORIES) as CommunityCategory[]).map((k) => ({ value: k, label: COMMUNITY_CATEGORIES[k] }))]}
          value={category}
          onChange={setCategory}
        />
        {city && (
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
            <input type="checkbox" className="size-5" checked={onlyCity} onChange={(e) => setOnlyCity(e.target.checked)} />
            Só de {city.name}
          </label>
        )}
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : (list.data ?? []).length === 0 ? (
          <EmptyState icon={Users} title={list.isLoading ? 'Carregando…' : 'Nenhuma comunidade encontrada'} description="Crie a primeira comunidade sobre este assunto." />
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">{(list.data ?? []).map((c) => <li key={c.id}><CommunityCard c={c} /></li>)}</ul>
        )}
      </section>
    </Page>
  )
}

// ---------- página da comunidade ----------
function TopicList({ c, canPost }: { c: Community; canPost: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const topics = useQuery({ queryKey: ['conectuai', 'topics', c.id], queryFn: () => listTopics(c.id) })
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const create = useMutation({
    mutationFn: () => createTopic(c.id, { title, body }),
    onSuccess: (id) => {
      refreshKeys(qc)
      navigate(`/conectuai/c/${c.slug}/t/${id}`)
    },
    onError: (e) => toast.error(errMsg(e)),
  })
  return (
    <div className="flex flex-col gap-3">
      {canPost && (open ? (
        <form
          className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4"
          onSubmit={(e) => {
            e.preventDefault()
            const parsed = topicFormSchema.safeParse({ title, body })
            if (!parsed.success) return toast.error(parsed.error.issues[0]!.message)
            create.mutate()
          }}
        >
          <label htmlFor="tp-titulo" className="text-sm font-medium text-ink">Título do tópico</label>
          <input id="tp-titulo" maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)} className={`${field} min-h-11`} />
          <label htmlFor="tp-texto" className="text-sm font-medium text-ink">Mensagem</label>
          <textarea id="tp-texto" maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} className={`${field} min-h-28 py-2`} />
          <div className="flex gap-2">
            <button type="submit" disabled={create.isPending} className={`${btn} bg-brand text-surface`}>Publicar tópico</button>
            <button type="button" onClick={() => setOpen(false)} className={`${btn} border border-line text-ink`}>Cancelar</button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={`${btn} w-fit bg-brand text-surface`}><Plus aria-hidden="true" className="size-4" />Novo tópico</button>
      ))}
      {topics.isError ? (
        <ErrorState error={topics.error} onRetry={() => void topics.refetch()} />
      ) : (topics.data ?? []).length === 0 ? (
        <p className="text-sm text-ink-muted">{topics.isLoading ? 'Carregando…' : 'Nenhum tópico ainda. Puxe o primeiro assunto.'}</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {(topics.data ?? []).map((t) => (
            <li key={t.id}>
              <Link to={`/conectuai/c/${c.slug}/t/${t.id}`} className="pressable flex items-start gap-3 p-4 hover:bg-muted">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 font-semibold text-ink">
                    {t.isPinned && <Pin aria-label="Fixado" className="size-4 text-warm" />}
                    {t.isLocked && <Lock aria-label="Trancado" className="size-4 text-ink-muted" />}
                    <span className={t.hidden ? 'text-ink-muted line-through' : ''}>{t.title}</span>
                  </span>
                  <span className="block text-xs text-ink-muted">por {t.author?.displayName ?? 'perfil indisponível'} · {relative(t.lastActivityAt)}</span>
                </span>
                <span className="shrink-0 text-sm text-ink-muted">{t.replyCount} {t.replyCount === 1 ? 'resposta' : 'respostas'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PollCard({ p, canVote }: { p: Poll; canVote: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const m = useMutation({ mutationFn: (opt: string) => vote(p.id, opt), onSuccess: () => refreshKeys(qc), onError: (e) => toast.error(errMsg(e)) })
  const showResults = p.closed || !!p.myVote || !canVote
  return (
    <article className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
      <h3 className="font-semibold text-ink">{p.question}</h3>
      <ul className="flex flex-col gap-2">
        {p.options.map((o) => {
          const pct = p.totalVotes ? Math.round((o.votes / p.totalVotes) * 100) : 0
          return (
            <li key={o.id}>
              {showResults ? (
                <div className="relative overflow-hidden rounded-xl border border-line px-3 py-2 text-sm">
                  <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-muted" style={{ width: `${pct}%` }} />
                  <span className="relative flex justify-between gap-2 text-ink">
                    <span>{o.label}{p.myVote === o.id && ' · seu voto'}</span>
                    <span className="tabular-nums">{pct}% ({o.votes})</span>
                  </span>
                </div>
              ) : (
                <button type="button" disabled={m.isPending} onClick={() => m.mutate(o.id)} className="pressable min-h-11 w-full rounded-xl border border-line px-3 text-left text-sm text-ink hover:bg-muted">{o.label}</button>
              )}
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-ink-muted">{p.totalVotes} {p.totalVotes === 1 ? 'voto' : 'votos'} · {p.closed ? 'encerrada' : `encerra ${relative(p.closesAt)}`}</p>
    </article>
  )
}

function Polls({ c, canPost }: { c: Community; canPost: boolean }) {
  const { session } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const polls = useQuery({ queryKey: ['conectuai', 'polls', c.id, session?.user.id ?? ''], queryFn: () => listPolls(c.id, session?.user.id ?? null) })
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [days, setDays] = useState(7)
  const create = useMutation({
    mutationFn: () => createPoll(c.id, question, options, days),
    onSuccess: () => {
      setOpen(false)
      setQuestion('')
      setOptions(['', ''])
      refreshKeys(qc)
    },
    onError: (e) => toast.error(errMsg(e)),
  })
  return (
    <div className="flex flex-col gap-3">
      {canPost && (open ? (
        <form className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4" onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
          <label htmlFor="pl-q" className="text-sm font-medium text-ink">Pergunta</label>
          <input id="pl-q" maxLength={200} value={question} onChange={(e) => setQuestion(e.target.value)} className={`${field} min-h-11`} />
          {options.map((o, i) => (
            <div key={i}>
              <label htmlFor={`pl-o${i}`} className="sr-only">Opção {i + 1}</label>
              <input id={`pl-o${i}`} maxLength={100} value={o} placeholder={`Opção ${i + 1}`} onChange={(e) => setOptions((p) => p.map((x, j) => (j === i ? e.target.value : x)))} className={`${field} min-h-11`} />
            </div>
          ))}
          {options.length < 6 && <button type="button" onClick={() => setOptions((p) => [...p, ''])} className="w-fit text-sm font-semibold text-brand">+ adicionar opção</button>}
          <label htmlFor="pl-d" className="text-sm font-medium text-ink">Duração</label>
          <select id="pl-d" value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${field} min-h-11 w-auto`}>
            {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} {d === 1 ? 'dia' : 'dias'}</option>)}
          </select>
          <div className="flex gap-2">
            <button type="submit" disabled={create.isPending} className={`${btn} bg-brand text-surface`}>Criar enquete</button>
            <button type="button" onClick={() => setOpen(false)} className={`${btn} border border-line text-ink`}>Cancelar</button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={`${btn} w-fit bg-brand text-surface`}><Plus aria-hidden="true" className="size-4" />Nova enquete</button>
      ))}
      {(polls.data ?? []).length === 0 ? (
        <p className="text-sm text-ink-muted">{polls.isLoading ? 'Carregando…' : 'Nenhuma enquete ainda.'}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">{(polls.data ?? []).map((p) => <li key={p.id}><PollCard p={p} canVote={canPost} /></li>)}</ul>
      )}
    </div>
  )
}

const ROLE_LABEL = { owner: 'Dona/dono', moderator: 'Moderação', member: 'Membro' } as const

function MemberRow({ m, c, myRole, pending, banned }: { m: Member; c: Community; myRole: string | null; pending?: boolean; banned?: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const act = useMutation({ mutationFn: (a: Parameters<typeof manageMember>[2]) => manageMember(c.id, m.userId, a), onSuccess: () => refreshKeys(qc), onError: (e) => toast.error(errMsg(e)) })
  const isMod = myRole === 'owner' || myRole === 'moderator'
  const canTouch = isMod && m.role !== 'owner' && (m.role !== 'moderator' || myRole === 'owner')
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <Avatar profile={m.profile} size={32} />
      <Link to={`/conectuai/u/${m.profile?.handle ?? ''}`} className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{m.profile?.displayName ?? 'Perfil indisponível'}</Link>
      {!pending && !banned && <span className="text-xs text-ink-muted">{ROLE_LABEL[m.role]}</span>}
      {canTouch && pending && (
        <>
          <button type="button" onClick={() => act.mutate('approve')} className={`${btn} bg-brand text-surface`}>Aprovar</button>
          <button type="button" onClick={() => act.mutate('reject')} className={`${btn} border border-line text-ink`}>Recusar</button>
        </>
      )}
      {canTouch && banned && <button type="button" onClick={() => act.mutate('unban')} className={`${btn} border border-line text-ink`}>Desbanir</button>}
      {canTouch && !pending && !banned && (
        <>
          {myRole === 'owner' && m.role === 'member' && <button type="button" onClick={() => act.mutate('promote')} className={`${btn} border border-line text-ink`}>Tornar moderador</button>}
          {myRole === 'owner' && m.role === 'moderator' && <button type="button" onClick={() => act.mutate('demote')} className={`${btn} border border-line text-ink`}>Remover moderação</button>}
          <button type="button" onClick={() => act.mutate('ban')} className={`${btn} border border-danger text-danger`}>Banir</button>
        </>
      )}
    </li>
  )
}

function Members({ c, myRole }: { c: Community; myRole: string | null }) {
  const isMod = myRole === 'owner' || myRole === 'moderator'
  const active = useQuery({ queryKey: ['conectuai', 'members', c.id, 'active'], queryFn: () => listMembers(c.id, 'active') })
  const pending = useQuery({ queryKey: ['conectuai', 'members', c.id, 'pending'], queryFn: () => listMembers(c.id, 'pending'), enabled: isMod })
  const banned = useQuery({ queryKey: ['conectuai', 'members', c.id, 'banned'], queryFn: () => listMembers(c.id, 'banned'), enabled: isMod })
  return (
    <div className="flex flex-col gap-4">
      {isMod && (pending.data ?? []).length > 0 && (
        <section aria-labelledby="mb-pend" className="rounded-card border border-warm bg-surface p-4">
          <h3 id="mb-pend" className="text-sm font-semibold text-ink">Pedidos de entrada</h3>
          <ul className="divide-y divide-line">{(pending.data ?? []).map((m) => <MemberRow key={m.userId} m={m} c={c} myRole={myRole} pending />)}</ul>
        </section>
      )}
      <section aria-labelledby="mb-at" className="rounded-card border border-line bg-surface p-4">
        <h3 id="mb-at" className="text-sm font-semibold text-ink">{c.memberCount} {c.memberCount === 1 ? 'membro' : 'membros'}</h3>
        {active.isError ? <ErrorState error={active.error} /> : <ul className="divide-y divide-line">{(active.data ?? []).map((m) => <MemberRow key={m.userId} m={m} c={c} myRole={myRole} />)}</ul>}
      </section>
      {isMod && (banned.data ?? []).length > 0 && (
        <section aria-labelledby="mb-ban" className="rounded-card border border-line bg-surface p-4">
          <h3 id="mb-ban" className="text-sm font-semibold text-ink">Banidos</h3>
          <ul className="divide-y divide-line">{(banned.data ?? []).map((m) => <MemberRow key={m.userId} m={m} c={c} myRole={myRole} banned />)}</ul>
        </section>
      )}
    </div>
  )
}

type CommunityTab = 'topicos' | 'enquetes' | 'membros' | 'sobre' | 'config'

export function CommunityPage() {
  const { slug = '' } = useParams()
  const { session } = useAuth()
  const me = session?.user.id ?? null
  const profile = useMySocialProfile()
  const qc = useQueryClient()
  const toast = useToast()
  const [tab, setTab] = useState<CommunityTab>('topicos')
  const [reporting, setReporting] = useState(false)
  const q = useQuery({ queryKey: ['conectuai', 'community', slug], queryFn: () => getCommunity(slug) })
  const c = q.data
  const membership = useQuery({ queryKey: ['conectuai', 'membership', c?.id ?? '', me ?? ''], queryFn: () => getMembership(c!.id, me!), enabled: !!c && !!me })
  const join = useMutation({ mutationFn: () => joinCommunity(c!.id), onSuccess: () => refreshKeys(qc), onError: (e) => toast.error(errMsg(e)) })
  const leave = useMutation({ mutationFn: () => leaveCommunity(c!.id, me!), onSuccess: () => refreshKeys(qc), onError: (e) => toast.error(errMsg(e)) })

  if (q.isLoading) return <Page><p role="status" className="text-sm text-ink-muted">Carregando…</p></Page>
  if (q.isError) return <Page><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Page>
  if (!c) return <Page><NotFoundState title="Comunidade não encontrada" /></Page>
  const m = membership.data
  const active = m?.status === 'active'
  const myRole = active ? m!.role : null
  const canRead = !c.isPrivate || active
  const tabs: { value: CommunityTab; label: string }[] = [
    { value: 'topicos', label: 'Tópicos' },
    { value: 'enquetes', label: 'Enquetes' },
    { value: 'membros', label: 'Membros' },
    { value: 'sobre', label: 'Sobre e regras' },
    ...(myRole === 'owner' ? [{ value: 'config' as const, label: 'Configurações' }] : []),
  ]

  return (
    <Page>
      <Link to="/conectuai/c" className="pressable inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-ink"><ArrowLeft aria-hidden="true" className="size-4" />Comunidades</Link>
      <header className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 md:p-6">
        <div className="flex items-center gap-4">
          <CommunityBadge c={c} size={64} />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-ink">{c.name}</h1>
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
              <span>{COMMUNITY_CATEGORIES[c.category]}</span>
              <span>· {c.memberCount} {c.memberCount === 1 ? 'membro' : 'membros'}</span>
              <span className="inline-flex items-center gap-1">· {c.isPrivate ? <><Lock aria-hidden="true" className="size-3.5" />Fechada</> : <><LockOpen aria-hidden="true" className="size-3.5" />Aberta</>}</span>
            </p>
          </div>
        </div>
        {c.description && <p className="whitespace-pre-wrap text-sm text-ink">{c.description}</p>}
        <div className="flex flex-wrap gap-2">
          {!me ? (
            <Link to="/entrar" className={`${btn} bg-brand text-surface`}>Entre para participar</Link>
          ) : profile.data === null ? (
            <Link to="/conectuai" className={`${btn} bg-brand text-surface`}>Crie seu perfil para participar</Link>
          ) : !m ? (
            <button type="button" disabled={join.isPending} onClick={() => join.mutate()} className={`${btn} bg-orange text-ink`}>{c.isPrivate ? 'Pedir para entrar' : 'Participar'}</button>
          ) : m.status === 'pending' ? (
            <button type="button" onClick={() => leave.mutate()} className={`${btn} border border-line text-ink`}>Pedido enviado · cancelar</button>
          ) : m.status === 'banned' ? (
            <span className="text-sm text-danger">Você foi removido desta comunidade.</span>
          ) : m.role !== 'owner' ? (
            <button type="button" onClick={() => { if (window.confirm('Sair da comunidade?')) leave.mutate() }} className={`${btn} border border-line text-ink`}>Sair da comunidade</button>
          ) : (
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-ink"><ShieldCheck aria-hidden="true" className="size-4 text-brand" />Você criou esta comunidade</span>
          )}
          {me && <button type="button" onClick={() => setReporting(true)} className={`${btn} border border-line text-ink`}>Denunciar</button>}
        </div>
      </header>
      <FilterChips label="Seções da comunidade" options={tabs} value={tab} onChange={setTab} />
      {!canRead && tab !== 'sobre' ? (
        <EmptyState icon={Lock} title="Comunidade fechada" description="Peça para entrar. Os moderadores aprovam a entrada e só membros veem os tópicos." />
      ) : tab === 'topicos' ? (
        <TopicList c={c} canPost={active} />
      ) : tab === 'enquetes' ? (
        <Polls c={c} canPost={active} />
      ) : tab === 'membros' ? (
        <Members c={c} myRole={myRole} />
      ) : tab === 'config' ? (
        <CommunityFormView existing={c} onDone={() => setTab('sobre')} />
      ) : (
        <section aria-labelledby="regras" className="rounded-card border border-line bg-surface p-4">
          <h2 id="regras" className="mb-2 text-lg font-semibold text-ink">Regras</h2>
          <p className="whitespace-pre-wrap text-sm text-ink">{c.rules || 'Esta comunidade segue as regras de convivência do Conectuaí: respeito, sem ofensas, ameaças, discriminação ou spam.'}</p>
          <p className="mt-3 text-xs text-ink-muted">Criada {relative(c.createdAt)}. Moderadores da comunidade podem ocultar conteúdo e banir membros; decisões da equipe Tucaí podem ser contestadas.</p>
        </section>
      )}
      {reporting && <ReportDialog open onClose={() => setReporting(false)} target={{ type: 'community', id: c.id }} />}
    </Page>
  )
}

// ---------- tópico ----------
export function TopicPage() {
  const { slug = '', topicId = '' } = useParams()
  const { session } = useAuth()
  const me = session?.user.id ?? null
  const qc = useQueryClient()
  const toast = useToast()
  const [body, setBody] = useState('')
  const [reporting, setReporting] = useState<{ type: 'topic' | 'reply'; id: string } | null>(null)
  const community = useQuery({ queryKey: ['conectuai', 'community', slug], queryFn: () => getCommunity(slug) })
  const c = community.data
  const membership = useQuery({ queryKey: ['conectuai', 'membership', c?.id ?? '', me ?? ''], queryFn: () => getMembership(c!.id, me!), enabled: !!c && !!me })
  const topic = useQuery({ queryKey: ['conectuai', 'topic', topicId], queryFn: () => getTopic(topicId) })
  const replies = useQuery({ queryKey: ['conectuai', 'replies', topicId], queryFn: () => listReplies(topicId), enabled: !!topic.data })
  const reply = useMutation({ mutationFn: () => addReply(topicId, body), onSuccess: () => { setBody(''); refreshKeys(qc) }, onError: (e) => toast.error(errMsg(e)) })
  const flags = useMutation({ mutationFn: (f: { isPinned?: boolean; isLocked?: boolean }) => setTopicFlags(topicId, f), onSuccess: () => refreshKeys(qc), onError: (e) => toast.error(errMsg(e)) })
  const moderate = useMutation({ mutationFn: (a: { type: 'topic' | 'reply'; id: string; hide: boolean }) => moderateCommunityContent(a.type, a.id, a.hide), onSuccess: () => refreshKeys(qc), onError: (e) => toast.error(errMsg(e)) })
  const delReply = useMutation({ mutationFn: deleteReply, onSuccess: () => refreshKeys(qc), onError: (e) => toast.error(errMsg(e)) })

  if (topic.isLoading || community.isLoading) return <Page><p role="status" className="text-sm text-ink-muted">Carregando…</p></Page>
  const t: Topic | null | undefined = topic.data
  if (topic.isError) return <Page><ErrorState error={topic.error} onRetry={() => void topic.refetch()} /></Page>
  if (!t || !c) return <Page><NotFoundState title="Tópico indisponível" description="Ele pode ter sido removido ou pertencer a uma comunidade fechada." /></Page>
  const active = membership.data?.status === 'active'
  const isMod = active && (membership.data!.role === 'owner' || membership.data!.role === 'moderator')

  return (
    <Page>
      <Link to={`/conectuai/c/${c.slug}`} className="pressable inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-ink"><ArrowLeft aria-hidden="true" className="size-4" />{c.name}</Link>
      <article className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 md:p-6">
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold text-ink">
          {t.isPinned && <Pin aria-label="Fixado" className="size-5 text-warm" />}
          {t.isLocked && <Lock aria-label="Trancado" className="size-5 text-ink-muted" />}
          {t.title}
        </h1>
        <p className="flex items-center gap-2 text-xs text-ink-muted"><Avatar profile={t.author} size={24} />{t.author?.displayName ?? 'Perfil indisponível'} · {relative(t.createdAt)}{t.editedAt ? ' · editado' : ''}</p>
        {t.hidden && <p className="rounded-xl border border-warm bg-warm-soft p-2 text-sm text-ink">Tópico ocultado pela moderação.</p>}
        <p className="whitespace-pre-wrap break-words text-[0.9375rem] leading-relaxed text-ink">{t.body}</p>
        <div className="flex flex-wrap gap-2">
          {isMod && (
            <>
              <button type="button" onClick={() => flags.mutate({ isPinned: !t.isPinned })} className={`${btn} border border-line text-ink`}>{t.isPinned ? 'Desafixar' : 'Fixar'}</button>
              <button type="button" onClick={() => flags.mutate({ isLocked: !t.isLocked })} className={`${btn} border border-line text-ink`}>{t.isLocked ? 'Destrancar' : 'Trancar'}</button>
              <button type="button" onClick={() => moderate.mutate({ type: 'topic', id: t.id, hide: !t.hidden })} className={`${btn} border border-danger text-danger`}>{t.hidden ? 'Restaurar' : 'Ocultar'}</button>
            </>
          )}
          {me && me !== t.authorId && <button type="button" onClick={() => setReporting({ type: 'topic', id: t.id })} className={`${btn} border border-line text-ink`}>Denunciar</button>}
        </div>
      </article>
      <section aria-labelledby="respostas" className="flex flex-col gap-3">
        <h2 id="respostas" className="text-lg font-semibold text-ink">{t.replyCount} {t.replyCount === 1 ? 'resposta' : 'respostas'}</h2>
        <ul className="flex flex-col gap-2">
          {(replies.data ?? []).map((r) => (
            <li key={r.id} className="flex gap-3 rounded-card border border-line bg-surface p-3">
              <Avatar profile={r.author} size={32} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{r.author?.displayName ?? 'Perfil indisponível'} <span className="font-normal text-ink-muted">· {relative(r.createdAt)}</span></p>
                {r.hidden ? <p className="text-sm italic text-ink-muted">Resposta ocultada pela moderação.</p> : <p className="whitespace-pre-wrap break-words text-sm text-ink">{r.body}</p>}
                <div className="flex flex-wrap gap-3 text-xs font-semibold text-ink-muted">
                  {me === r.authorId && <button type="button" className="min-h-8" onClick={() => delReply.mutate(r.id)}>Excluir</button>}
                  {isMod && <button type="button" className="min-h-8" onClick={() => moderate.mutate({ type: 'reply', id: r.id, hide: !r.hidden })}>{r.hidden ? 'Restaurar' : 'Ocultar'}</button>}
                  {me && me !== r.authorId && <button type="button" className="min-h-8" onClick={() => setReporting({ type: 'reply', id: r.id })}>Denunciar</button>}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {!me ? (
          <LoginInvite title="Entre para responder" description="Participe das conversas da região." />
        ) : !active ? (
          <p className="text-sm text-ink-muted">Entre na comunidade para responder.</p>
        ) : t.isLocked ? (
          <p className="text-sm text-ink-muted">Tópico trancado pelos moderadores.</p>
        ) : (
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (body.trim()) reply.mutate() }}>
            <label htmlFor="resp" className="text-sm font-medium text-ink">Sua resposta</label>
            <textarea id="resp" maxLength={3000} value={body} onChange={(e) => setBody(e.target.value)} className={`${field} min-h-24 py-2`} />
            <button type="submit" disabled={reply.isPending || !body.trim()} className={`${btn} w-fit bg-brand text-surface`}>Responder</button>
          </form>
        )}
      </section>
      {reporting && <ReportDialog open onClose={() => setReporting(null)} target={reporting} />}
    </Page>
  )
}
