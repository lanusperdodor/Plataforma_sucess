import { Bookmark, Briefcase, CalendarDays, Heart, MapPin, Megaphone, MessageCircle, Play, Rocket, Sparkles, Store, Tag, Users, Zap, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../components/feedback/toast-context.ts'
import { FilterChips } from '../components/nav/FilterChips.tsx'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { useFeatured } from '../features/catalog/hooks.ts'
import { DEMO_POSTS, POST_TYPE_LABEL, relativeTime, type DemoPost, type PostType } from '../features/demo/preview-data.ts'
import { useCurrentCity } from '../features/location/cityStore.ts'

const TYPE_ICON: Record<PostType, LucideIcon> = {
  imagem_texto: Megaphone,
  promocao: Tag,
  oferta_relampago: Zap,
  vaga: Briefcase,
  evento: CalendarDays,
  video: Play,
  atualizacao_comercial: Megaphone,
  novo_produto: Sparkles,
}

const FILTERS = [
  { value: 'todos', label: 'Tudo' },
  { value: 'promocao', label: 'Promoções' },
  { value: 'novo_produto', label: 'Novidades' },
  { value: 'evento', label: 'Eventos' },
  { value: 'vaga', label: 'Vagas' },
  { value: 'video', label: 'Vídeos' },
] as const
type Filter = (typeof FILTERS)[number]['value']

function businessPath(p: DemoPost) {
  return p.businessKind === 'restaurante' ? `/restaurantes/${p.businessSlug}` : p.businessKind === 'loja' ? `/lojas/${p.businessSlug}` : `/servicos/${p.businessSlug}`
}

/** Interações da prévia ficam só na tela (nada é salvo) e avisam isso uma vez. */
function usePreviewNotice() {
  const toast = useToast()
  const [told, setTold] = useState(false)
  return () => {
    if (told) return
    setTold(true)
    toast.info('Prévia: curtidas, salvos e seguidas ainda não são gravados.')
  }
}

function PostCard({ post, onInteract }: { post: DemoPost; onInteract: () => void }) {
  const [liked, setLiked] = useState(false)
  const [saved, setSaved] = useState(false)
  const [following, setFollowing] = useState(false)
  const Icon = TYPE_ICON[post.type]
  const hot = post.type === 'promocao' || post.type === 'oferta_relampago'
  const action = 'pressable inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium'
  return (
    <article className="overflow-hidden rounded-card border border-line bg-surface">
      <header className="flex items-center gap-3 p-4 pb-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-orange">
          <Store className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <Link to={businessPath(post)} className="block truncate text-sm font-semibold text-ink">{post.businessName}</Link>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
            <span>{relativeTime(post.minutesAgo)}</span>
            {post.location && (
              <span className="inline-flex items-center gap-0.5">
                <MapPin aria-hidden="true" className="size-3" />
                {post.location}
              </span>
            )}
            {post.sponsored && (
              <span className="inline-flex items-center gap-0.5 font-semibold text-warm">
                <Rocket aria-hidden="true" className="size-3" />
                Turbinado · Patrocinado
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          aria-pressed={following}
          onClick={() => {
            setFollowing((v) => !v)
            onInteract()
          }}
          className={`pressable min-h-11 shrink-0 rounded-full px-4 text-xs font-semibold ${following ? 'border border-line bg-surface text-ink' : 'bg-brand text-surface'}`}
        >
          {following ? 'Seguindo' : 'Seguir'}
        </button>
      </header>
      <div className={`relative mx-4 flex aspect-[2/1] items-center justify-center overflow-hidden rounded-2xl ${hot ? 'bg-orange text-ink' : 'bg-muted text-ink'}`}>
        <Icon aria-hidden="true" className="size-10 opacity-70" />
        {post.type === 'video' && <span className="sr-only">Vídeo (reprodução disponível em breve)</span>}
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-surface/95 px-2 py-0.5 text-xs font-semibold text-ink">
          {POST_TYPE_LABEL[post.type]}
        </span>
        {post.highlight && <span className="absolute bottom-2 left-2 rounded-full bg-ink px-3 py-1 text-xs font-semibold text-surface">{post.highlight}</span>}
      </div>
      <p className="px-4 pt-3 text-sm text-ink">{post.text}</p>
      <footer className="flex items-center gap-1 px-2 py-1">
        <button
          type="button"
          aria-pressed={liked}
          aria-label={`Curtir publicação de ${post.businessName}`}
          onClick={() => {
            setLiked((v) => !v)
            onInteract()
          }}
          className={`${action} ${liked ? 'text-warm' : 'text-ink-muted'}`}
        >
          <Heart aria-hidden="true" className={`size-5 ${liked ? 'fill-current' : ''}`} />
          {post.likes + (liked ? 1 : 0)}
        </button>
        <span className={`${action} text-ink-muted`} aria-label={`${post.comments} comentários`}>
          <MessageCircle aria-hidden="true" className="size-5" />
          {post.comments}
        </span>
        <button
          type="button"
          aria-pressed={saved}
          aria-label="Salvar publicação"
          onClick={() => {
            setSaved((v) => !v)
            onInteract()
          }}
          className={`${action} ml-auto ${saved ? 'text-ink' : 'text-ink-muted'}`}
        >
          <Bookmark aria-hidden="true" className={`size-5 ${saved ? 'fill-current' : ''}`} />
        </button>
      </footer>
    </article>
  )
}

/** Comunidade: feed comercial da cidade (prévia com publicações de demonstração). */
export function CommunityPage() {
  const [filter, setFilter] = useState<Filter>('todos')
  const notice = usePreviewNotice()
  const { city } = useCurrentCity()
  const featured = useFeatured(city?.id)
  // Turbinadas sobem para o topo, sempre identificadas como patrocinadas.
  const posts = DEMO_POSTS.filter((p) => filter === 'todos' || p.type === filter || (filter === 'promocao' && p.type === 'oferta_relampago')).sort(
    (a, b) => Number(!!b.sponsored) - Number(!!a.sponsored),
  )

  return (
    <Page>
      <PageHeader icon={Users} title="Comunidade" subtitle={`O que acontece no comércio de ${city?.name ?? 'sua cidade'}.`} />
      <FilterChips label="Tipo de publicação" options={FILTERS} value={filter} onChange={setFilter} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <ul className="flex w-full flex-col gap-4">
          {posts.map((p) => (
            <li key={p.id}>
              <PostCard post={p} onInteract={notice} />
            </li>
          ))}
          {posts.length === 0 && <li className="text-sm text-ink-muted">Nenhuma publicação deste tipo ainda.</li>}
        </ul>
        <aside aria-labelledby="com-destaques" className="hidden lg:block">
          <div className="sticky top-[calc(var(--header-h-compact)+1rem)] flex flex-col gap-4">
            <div className="rounded-card border border-line bg-surface p-4">
              <h2 id="com-destaques" className="text-sm font-semibold text-ink">Comércios em destaque</h2>
              <ul className="mt-3 flex flex-col gap-1">
                {(featured.data ?? []).map((b) => (
                  <li key={b.id}>
                    <Link to={`/${b.businessType === 'restaurante' ? 'restaurantes' : 'lojas'}/${b.slug}`} className="pressable flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm text-ink hover:bg-muted">
                      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-orange">
                        <Store className="size-4" />
                      </span>
                      <span className="truncate">{b.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-card bg-brand p-4 text-surface">
              <p className="flex items-center gap-2 text-sm font-bold">
                <Rocket aria-hidden="true" className="size-4 text-orange" />
                Turbine sua publicação
              </p>
              <p className="mt-1 text-xs opacity-90">Empresas pagam para destacar uma publicação no topo do feed, com o selo “Turbinado · Patrocinado”.</p>
              <p className="mt-3 inline-flex rounded-full bg-orange px-3 py-1 text-xs font-semibold text-ink">Em breve no painel da empresa</p>
            </div>
          </div>
        </aside>
      </div>
    </Page>
  )
}