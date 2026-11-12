import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { HeartHandshake, MessagesSquare, ShieldCheck, Users } from 'lucide-react'
import { ConectuaiNav } from './conectuai/ConectuaiNav.tsx'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/feedback/EmptyState.tsx'
import { ErrorState } from '../components/feedback/ErrorState.tsx'
import { LoginInvite } from '../components/feedback/LoginInvite.tsx'
import { SkeletonCard } from '../components/feedback/Skeleton.tsx'
import { useToast } from '../components/feedback/toast-context.ts'
import { FilterChips } from '../components/nav/FilterChips.tsx'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import {
  getPostsByIds,
  type Post,
  createPost,
  getProfileByUser,
  listFeed,
  profileFormSchema,
  saveMyProfile,
  type FeedScope,
  type ProfileForm,
  type SocialProfile,
} from '../features/conecta/repository.ts'
import { getSponsoredFeed, trackAd } from '../features/ads/repository.ts'
import { useCurrentCity } from '../features/location/cityStore.ts'
import { listMyBusinesses, listProducts } from '../features/merchant/repository.ts'
import { canInBusiness } from '../features/permissions/permissions.ts'
import { Avatar, PostCard, btn, errMsg, field, useConectaRefresh } from './conecta/components.tsx'

const RULES = [
  { icon: HeartHandshake, text: 'Elogios e críticas são bem-vindos, sempre com respeito.' },
  { icon: ShieldCheck, text: 'Ofensas, ameaças, assédio e discriminação não são tolerados.' },
  { icon: MessagesSquare, text: 'Conteúdo patrocinado é sempre identificado.' },
]

export function useMySocialProfile() {
  const { session } = useAuth()
  const userId = session?.user.id
  return useQuery({ queryKey: ['conecta', 'me', userId ?? ''], queryFn: () => getProfileByUser(userId!), enabled: !!userId })
}

/** Criação/edição do perfil social (separado dos dados privados da conta). */
export function ProfileSetup({ existing, onDone }: { existing: SocialProfile | null; onDone?: () => void }) {
  const { session } = useAuth()
  const { cities } = useCurrentCity()
  const toast = useToast()
  const refresh = useConectaRefresh()
  const [v, setV] = useState<ProfileForm>({
    handle: existing?.handle ?? '',
    displayName: existing?.displayName ?? '',
    bio: existing?.bio ?? '',
    avatarUrl: existing?.avatarUrl ?? '',
    cityId: existing?.cityId ?? '',
    isPublic: existing?.isPublic ?? true,
    wallEnabled: existing?.wallEnabled ?? true,
    wallAudience: existing?.wallAudience ?? 'everyone',
    showConnections: existing?.showConnections ?? true,
    testimonialsEnabled: existing?.testimonialsEnabled ?? true,
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const save = useMutation({
    mutationFn: () => saveMyProfile(session!.user.id, v, !!existing),
    onSuccess: () => {
      toast.success(existing ? 'Perfil atualizado.' : 'Bem-vindo ao Conectuaí!')
      refresh()
      onDone?.()
    },
    onError: (e) => toast.error(errMsg(e).includes('já existe') ? 'Este nome de usuário já está em uso.' : errMsg(e)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const parsed = profileFormSchema.safeParse(v)
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])))
    setErrors({})
    save.mutate()
  }
  const set = <K extends keyof ProfileForm>(k: K, val: ProfileForm[K]) => setV((p) => ({ ...p, [k]: val }))
  const err = (k: string) => (errors[k] ? <p role="alert" className="mt-1 text-xs text-danger">{errors[k]}</p> : null)
  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-3 rounded-card border border-line bg-surface p-4 md:grid-cols-2 md:p-6">
      <h2 className="text-lg font-semibold text-ink md:col-span-2">{existing ? 'Editar perfil social' : 'Crie seu perfil no Conectuaí'}</h2>
      {!existing && <p className="text-sm text-ink-muted md:col-span-2">Seu perfil social é público e separado dos dados da sua conta (e-mail e telefone nunca aparecem).</p>}
      <div>
        <label htmlFor="sp-handle" className="mb-1 block text-sm font-medium text-ink">Nome de usuário</label>
        <div className="flex items-center gap-1"><span className="text-ink-muted">@</span><input id="sp-handle" autoCapitalize="none" value={v.handle} onChange={(e) => set('handle', e.target.value.toLowerCase())} className={`${field} min-h-11`} /></div>
        {err('handle')}
      </div>
      <div>
        <label htmlFor="sp-name" className="mb-1 block text-sm font-medium text-ink">Nome de exibição</label>
        <input id="sp-name" maxLength={60} value={v.displayName} onChange={(e) => set('displayName', e.target.value)} className={`${field} min-h-11`} />
        {err('displayName')}
      </div>
      <div className="md:col-span-2">
        <label htmlFor="sp-bio" className="mb-1 block text-sm font-medium text-ink">Biografia</label>
        <textarea id="sp-bio" maxLength={300} value={v.bio} onChange={(e) => set('bio', e.target.value)} className={`${field} min-h-20 py-2`} />
      </div>
      <div>
        <label htmlFor="sp-avatar" className="mb-1 block text-sm font-medium text-ink">Foto (endereço https, opcional)</label>
        <input id="sp-avatar" inputMode="url" value={v.avatarUrl} onChange={(e) => set('avatarUrl', e.target.value)} className={`${field} min-h-11`} />
        {err('avatarUrl')}
      </div>
      <div>
        <label htmlFor="sp-city" className="mb-1 block text-sm font-medium text-ink">Cidade no perfil</label>
        <select id="sp-city" value={v.cityId} onChange={(e) => set('cityId', e.target.value)} className={`${field} min-h-11`}>
          <option value="">Não mostrar</option>
          {cities.map((c) => <option key={c.id} value={c.id}>{c.name}, {c.state}</option>)}
        </select>
      </div>
      <label className="flex min-h-11 items-start gap-2 text-sm text-ink md:col-span-2">
        <input type="checkbox" className="mt-0.5 size-5" checked={!v.isPublic} onChange={(e) => set('isPublic', !e.target.checked)} />
        <span>Perfil fechado <span className="block text-ink-muted">Suas publicações e sua lista de seguidores ficam visíveis só para quem segue você.</span></span>
      </label>
      <fieldset className="flex flex-col gap-1 md:col-span-2">
        <legend className="mb-1 text-sm font-medium text-ink">Quem pode ver e interagir</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
          <input type="checkbox" className="size-5" checked={v.wallEnabled} onChange={(e) => set('wallEnabled', e.target.checked)} />
          Ativar meu mural de recados
        </label>
        {v.wallEnabled && (
          <label className="flex min-h-11 items-center gap-2 pl-7 text-sm text-ink">
            <input type="checkbox" className="size-5" checked={v.wallAudience === 'friends'} onChange={(e) => set('wallAudience', e.target.checked ? 'friends' : 'everyone')} />
            Só amigos podem ver e deixar recados
          </label>
        )}
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
          <input type="checkbox" className="size-5" checked={v.showConnections} onChange={(e) => set('showConnections', e.target.checked)} />
          Mostrar minha lista de amigos e comunidades
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
          <input type="checkbox" className="size-5" checked={v.testimonialsEnabled} onChange={(e) => set('testimonialsEnabled', e.target.checked)} />
          Receber depoimentos de amigos (sempre com minha aprovação)
        </label>
      </fieldset>
      <div className="flex gap-2 md:col-span-2">
        <button type="submit" disabled={save.isPending} className={`${btn} bg-brand text-surface`}>{save.isPending ? 'Salvando…' : 'Salvar perfil'}</button>
        {onDone && existing && <button type="button" onClick={onDone} className={`${btn} border border-line text-ink`}>Cancelar</button>}
      </div>
    </form>
  )
}

function Composer({ profile }: { profile: SocialProfile }) {
  const { session, authz } = useAuth()
  const userId = session!.user.id
  const { city } = useCurrentCity()
  const toast = useToast()
  const refresh = useConectaRefresh()
  const [body, setBody] = useState('')
  const [as, setAs] = useState('')
  const [productId, setProductId] = useState('')
  const businesses = useQuery({ queryKey: ['merchant', 'list', userId], queryFn: () => listMyBusinesses(userId) })
  const publishable = (businesses.data ?? []).filter((b) => b.status === 'active' && (canInBusiness(authz, 'store.customize', b.id) || canInBusiness(authz, 'settings.manage', b.id)))
  const products = useQuery({ queryKey: ['merchant', 'products', as], queryFn: () => listProducts(as), enabled: !!as })
  const post = useMutation({
    mutationFn: () => createPost({ body, cityId: city?.id ?? null, businessId: as || null, productId: productId || null, sharedPostId: null }),
    onSuccess: () => {
      setBody('')
      setProductId('')
      refresh()
    },
    onError: (e) => toast.error(errMsg(e)),
  })
  return (
    <form
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (body.trim()) post.mutate()
      }}
    >
      <div className="flex gap-3">
        <Avatar profile={profile} />
        <div className="min-w-0 flex-1">
          <label htmlFor="composer" className="sr-only">Nova publicação</label>
          <textarea id="composer" maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={`O que está acontecendo em ${city?.name ?? 'sua cidade'}?`} className={`${field} min-h-20 py-2`} />
        </div>
      </div>
      {publishable.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <label htmlFor="composer-as" className="sr-only">Publicar como</label>
          <select id="composer-as" value={as} onChange={(e) => { setAs(e.target.value); setProductId('') }} className={`${field} min-h-11 w-auto`}>
            <option value="">Publicar como @{profile.handle}</option>
            {publishable.map((b) => <option key={b.id} value={b.id}>Publicar como {b.name}</option>)}
          </select>
          {as && (
            <>
              <label htmlFor="composer-product" className="sr-only">Produto da oferta</label>
              <select id="composer-product" value={productId} onChange={(e) => setProductId(e.target.value)} className={`${field} min-h-11 w-auto`}>
                <option value="">Sem produto vinculado</option>
                {(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-muted">{body.length}/2000 caracteres</span>
        <button type="submit" disabled={post.isPending || !body.trim()} className={`${btn} bg-orange text-ink`}>{post.isPending ? 'Publicando…' : 'Publicar'}</button>
      </div>
    </form>
  )
}

type Tab = 'cidade' | 'seguindo' | 'salvos'

/** Patrocinado: registra impressão (ao aparecer de verdade na tela) e clique; o banco conta uma vez por pessoa/dia. */
function SponsoredItem({ post, campaignId }: { post: Post; campaignId: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      if (!seen.current && entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5)) {
        seen.current = true
        void trackAd(campaignId, 'impressao')
        io.disconnect()
      }
    }, { threshold: [0.5] })
    io.observe(el)
    return () => io.disconnect()
  }, [campaignId])
  return (
    <div ref={ref} onClickCapture={(e) => { if ((e.target as HTMLElement).closest('a,button')) void trackAd(campaignId, 'clique') }}>
      <PostCard post={post} sponsored />
    </div>
  )
}

/** Intercala patrocinados: o primeiro no topo e depois um a cada N publicações (regra do Master). */
export function interleave<T>(organic: T[], sponsored: T[], every: number): { item: T; sponsored: boolean }[] {
  const out: { item: T; sponsored: boolean }[] = []
  let s = 0
  organic.forEach((p, i) => {
    if (s < sponsored.length && i % Math.max(every, 1) === 0) out.push({ item: sponsored[s++]!, sponsored: true })
    out.push({ item: p, sponsored: false })
  })
  if (organic.length === 0 && sponsored.length > 0) out.push({ item: sponsored[0]!, sponsored: true })
  return out
}

export function Feed({ scope, me, empty }: { scope: FeedScope; me: string | null; empty: { title: string; description: string } }) {
  const key = JSON.stringify(scope)
  const feed = useInfiniteQuery({
    queryKey: ['conecta', 'feed', key, me ?? ''],
    queryFn: ({ pageParam }) => listFeed(scope, me, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
  const cityId = scope.kind === 'city' ? scope.cityId : null
  // patrocinados só no feed da cidade, para quem está logado; a região vem da cidade escolhida (sem localização precisa)
  const ads = useQuery({
    queryKey: ['conecta', 'sponsored', cityId, me ?? ''],
    queryFn: async () => {
      const slots = await getSponsoredFeed(cityId!)
      const posts = await getPostsByIds(slots.map((x) => x.post_id), me)
      return { every: slots[0]?.slot_every ?? 6, items: slots.flatMap((x) => { const p = posts.find((q) => q.id === x.post_id); return p ? [{ campaignId: x.campaign_id, post: p }] : [] }) }
    },
    enabled: !!cityId && !!me,
    staleTime: 5 * 60_000,
  })
  const adIds = new Set((ads.data?.items ?? []).map((a) => a.post.id))
  const posts = (feed.data?.pages ?? []).flatMap((p) => p.posts).filter((p) => !adIds.has(p.id))
  if (feed.isLoading) return <div className="flex flex-col gap-4">{Array.from({ length: 2 }, (_, i) => <SkeletonCard key={i} />)}</div>
  if (feed.isError) return <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />
  if (posts.length === 0 && adIds.size === 0) return <EmptyState icon={Users} title={empty.title} description={empty.description} />
  const rows = interleave<{ campaignId: string | null; post: Post }>(posts.map((p) => ({ campaignId: null, post: p })), ads.data?.items ?? [], ads.data?.every ?? 6)
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-4">
        {rows.map(({ item, sponsored }) => (
          <li key={`${sponsored ? 'ad' : 'p'}-${item.post.id}`}>{sponsored && item.campaignId ? <SponsoredItem post={item.post} campaignId={item.campaignId} /> : <PostCard post={item.post} />}</li>
        ))}
      </ul>
      {feed.hasNextPage && (
        <button type="button" onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage} className={`${btn} mx-auto border border-line text-ink`}>
          {feed.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
    </div>
  )
}

/** Conectuaí: rede social regional com feed, comentários, curtidas e moderação humana. */
export function ConectaPage() {
  const { session } = useAuth()
  const me = session?.user.id ?? null
  const { city } = useCurrentCity()
  const profile = useMySocialProfile()
  const [tab, setTab] = useState<Tab>('cidade')
  const scope: FeedScope = tab === 'cidade' ? { kind: 'city', cityId: city?.id ?? null } : tab === 'seguindo' ? { kind: 'following' } : { kind: 'saved' }
  const empty = {
    cidade: { title: `Ainda não há publicações em ${city?.name ?? 'sua cidade'}`, description: 'Seja a primeira pessoa a publicar.' },
    seguindo: { title: 'Nada por aqui ainda', description: 'Siga perfis para ver as publicações deles nesta aba.' },
    salvos: { title: 'Nenhuma publicação salva', description: 'Toque no marcador de uma publicação para guardá-la aqui.' },
  }[tab]

  return (
    <Page>
      <PageHeader icon={MessagesSquare} title="Conectuaí" subtitle={`A rede social de ${city?.name ?? 'sua região'}.`} actions={profile.data ? <Link to={`/conectuai/u/${profile.data.handle}`} className={`${btn} border border-line text-ink`}>Meu perfil</Link> : undefined} />
      <ConectuaiNav />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          {!session ? (
            <LoginInvite icon={Users} title="Participe do Conectuaí" description="Entre para publicar, comentar e seguir pessoas e comércios da região." />
          ) : profile.isError ? (
            <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
          ) : profile.data === null ? (
            <ProfileSetup existing={null} />
          ) : profile.data ? (
            <Composer profile={profile.data} />
          ) : null}
          {session && (
            <FilterChips
              label="Feed"
              options={[{ value: 'cidade', label: city ? city.name : 'Cidade' }, { value: 'seguindo', label: 'Seguindo' }, { value: 'salvos', label: 'Salvos' }]}
              value={tab}
              onChange={(v) => setTab(v as Tab)}
            />
          )}
          <Feed scope={scope} me={me} empty={empty} />
        </div>
        <aside aria-labelledby="conecta-regras" className="hidden lg:block">
          <div className="sticky top-[calc(var(--header-h-compact)+1rem)] rounded-card border border-line bg-surface p-4">
            <h2 id="conecta-regras" className="text-sm font-semibold text-ink">Regras de convivência</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {RULES.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-2 text-sm text-ink-muted"><Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />{text}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-muted">Denúncias são revisadas por pessoas. Toda decisão pode ser contestada.</p>
          </div>
        </aside>
      </div>
    </Page>
  )
}
