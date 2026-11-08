import { Briefcase, Rocket, Search, Store, Users, UtensilsCrossed, Wrench, type LucideIcon } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { TucaPresenter } from '../components/brand/TucaPresenter.tsx'
import { BusinessCard } from '../components/cards/BusinessCard.tsx'
import { ErrorState } from '../components/feedback/ErrorState.tsx'
import { Img } from '../components/feedback/Img.tsx'
import { Skeleton, SkeletonCard } from '../components/feedback/Skeleton.tsx'
import { CategoryRail } from '../components/nav/CategoryRail.tsx'
import { Section } from '../components/nav/Section.tsx'
import { BRAND } from '../config/brand.ts'
import { useCategories, useFeatured, useRestaurants } from '../features/catalog/hooks.ts'
import type { BusinessSummary, Category } from '../features/catalog/schemas.ts'
import { DEMO_POSTS, POST_TYPE_LABEL, relativeTime } from '../features/demo/preview-data.ts'
import { useCurrentCity } from '../features/location/cityStore.ts'
import { useRecent, type RecentItem } from '../features/recent/recentStore.ts'

/** Quantos cards cada seção mostra (o "Ver mais" leva à listagem completa). */
const SECTION_LIMIT = 6

const PURPOSE_TITLE = 'Da sua cidade. Do seu jeito.'
const PURPOSE_SUBTITLE = 'Peça, descubra, acompanhe e conecte-se com o comércio local.'

const CTAS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/restaurantes', label: 'Restaurantes', icon: UtensilsCrossed },
  { to: '/comunidade', label: 'Comunidade', icon: Users },
  { to: '/lojas', label: 'Comércios', icon: Store },
]

export function categoryHref(c: Pick<Category, 'kind' | 'slug'>): string {
  const q = encodeURIComponent(c.slug)
  switch (c.kind) {
    case 'restaurante':
      return `/restaurantes?categoria=${q}`
    case 'loja':
      return `/lojas?categoria=${q}`
    case 'servico':
      return `/servicos?categoria=${q}`
    default:
      return '/vagas'
  }
}

function recentHref(r: RecentItem): string {
  switch (r.kind) {
    case 'restaurante':
      return `/restaurantes/${r.slug ?? r.id}`
    case 'loja':
      return `/lojas/${r.slug ?? r.id}`
    case 'servico':
      return `/servicos/${r.slug ?? r.id}`
    case 'vaga':
      return `/vagas/${r.id}`
    default:
      return `/comunidade/${r.id}`
  }
}

const RECENT_ICONS: Record<RecentItem['kind'], LucideIcon> = {
  restaurante: UtensilsCrossed,
  loja: Store,
  servico: Wrench,
  vaga: Briefcase,
  post: Users,
}

const SPAN_ALL = 'md:col-span-2 lg:col-span-3'

function PurposeCard() {
  return (
    <section aria-labelledby="home-purpose" className="relative overflow-hidden rounded-card border border-line bg-surface">
      <div className="grid items-center gap-2 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:gap-4 md:p-6 lg:p-8">
        {/* Um único Tuca: no alto, centro-direita no desktop; no topo do cartão no celular. */}
        <TucaPresenter className="order-first -mx-2 -mt-2 md:order-none md:col-start-2 md:row-start-1 md:mx-0 md:mt-0" />
        <div className="min-w-0 md:col-start-1 md:row-start-1">
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            <img src={BRAND.assets.icon} alt="" width={20} height={20} className="size-5 rounded-md" />
            {BRAND.slogan}
          </p>
          <h1 id="home-purpose" className="mt-2 text-[1.625rem] font-bold leading-tight text-ink md:text-4xl lg:text-5xl">
            {PURPOSE_TITLE}
          </h1>
          <p className="mt-2 max-w-prose text-sm text-ink-muted md:text-base">{PURPOSE_SUBTITLE}</p>
          <ul className="mt-5 flex flex-wrap gap-2">
            {CTAS.map(({ to, label, icon: Icon }, i) => (
              <li key={to}>
                <Link
                  to={to}
                  className={`pressable inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold ${
                    i === 0 ? 'bg-orange text-ink' : 'bg-brand text-surface'
                  }`}
                >
                  <Icon aria-hidden="true" className="size-5" />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function SearchEntry() {
  const navigate = useNavigate()
  const [term, setTerm] = useState('')
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const q = term.trim()
    void navigate(q ? `/busca?q=${encodeURIComponent(q)}` : '/busca')
  }
  return (
    <form role="search" aria-label="Busca" onSubmit={onSubmit} className="relative">
      <label htmlFor="home-search" className="sr-only">
        Buscar
      </label>
      <Search aria-hidden="true" className="pointer-events-none absolute left-5 top-1/2 size-5 -translate-y-1/2 text-ink-muted" />
      <input
        id="home-search"
        type="search"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Busque restaurantes, lojas, vagas, serviços…"
        autoComplete="off"
        className="min-h-14 w-full rounded-full border border-line bg-surface pl-13 pr-28 text-base text-ink placeholder:text-ink-muted"
      />
      <button type="submit" className="pressable absolute right-1.5 top-1/2 min-h-11 -translate-y-1/2 rounded-full bg-brand px-5 text-sm font-semibold text-surface">
        Buscar
      </button>
    </form>
  )
}

interface BusinessSectionProps {
  title: string
  subtitle: string
  moreTo: string
  businesses: BusinessSummary[]
  loading: boolean
  error: boolean
  onRetry: () => void
  categoryLabels: Map<string, string>
}

/** Seção de estabelecimentos: skeleton, erro com retry, oculta se vazia. */
function BusinessSection({ title, subtitle, moreTo, businesses, loading, error, onRetry, categoryLabels }: BusinessSectionProps) {
  if (loading) {
    return (
      <Section title={title} subtitle={subtitle} variant="carousel">
        {Array.from({ length: 3 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </Section>
    )
  }
  if (error) {
    return (
      <Section title={title} subtitle={subtitle}>
        <div className={SPAN_ALL}>
          <ErrorState onRetry={onRetry} />
        </div>
      </Section>
    )
  }
  return (
    <Section title={title} subtitle={subtitle} moreTo={moreTo} variant="carousel" empty={businesses.length === 0} hideWhenEmpty>
      {businesses.map((b) => (
        <BusinessCard key={b.id} business={b} categoryLabel={b.categoryId ? categoryLabels.get(b.categoryId) : undefined} />
      ))}
    </Section>
  )
}

/** Prévia curta da Comunidade: 3 publicações, turbinadas primeiro. */
function CommunityPreview() {
  const posts = [...DEMO_POSTS].sort((a, b) => Number(!!b.sponsored) - Number(!!a.sponsored)).slice(0, 3)
  return (
    <Section title="Na comunidade" subtitle="Novidades dos comércios da cidade" moreTo="/comunidade" variant="carousel">
      {posts.map((p) => (
        <Link key={p.id} to="/comunidade" className="hover-lift pressable flex min-h-32 flex-col gap-2 rounded-card border border-line bg-surface p-4">
          <span className="flex items-center gap-2 text-xs font-semibold text-ink-muted">
            <span className="rounded-full bg-muted px-2 py-0.5 text-ink">{POST_TYPE_LABEL[p.type]}</span>
            {p.sponsored && (
              <span className="inline-flex items-center gap-0.5 text-warm">
                <Rocket aria-hidden="true" className="size-3" />
                Patrocinado
              </span>
            )}
            <span className="ml-auto font-normal">{relativeTime(p.minutesAgo)}</span>
          </span>
          <span className="line-clamp-2 text-sm text-ink">{p.text}</span>
          <span className="mt-auto truncate text-xs font-semibold text-ink">{p.businessName}</span>
        </Link>
      ))}
    </Section>
  )
}

function RecentSection({ items }: { items: readonly RecentItem[] }) {
  if (items.length === 0) return null
  return (
    <Section title="Últimos vistos" subtitle="Para você voltar de onde parou" variant="carousel">
      {items.slice(0, SECTION_LIMIT).map((r) => {
        const Icon = RECENT_ICONS[r.kind]
        return (
          <Link key={`${r.kind}:${r.id}`} to={recentHref(r)} className="hover-lift pressable flex min-h-11 items-center gap-3 rounded-card border border-line bg-surface p-3">
            <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-card bg-muted text-ink-muted">
              {r.imageUrl ? <Img src={r.imageUrl} alt="" width={56} height={56} className="size-14 object-cover" /> : <Icon aria-hidden="true" className="size-6" />}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{r.name}</p>
              {r.isDemo && <p className="text-xs text-ink-muted">Demonstração</p>}
            </div>
          </Link>
        )
      })}
    </Section>
  )
}

export function HomePage() {
  const { city, isLoading: cityLoading, isError: cityError, refetch: refetchCity } = useCurrentCity()
  const cityId = city?.id
  const categories = useCategories()
  const nearby = useRestaurants(cityId, { sort: 'proximity' })
  const popular = useRestaurants(cityId, { sort: 'popularity' })
  const featured = useFeatured(cityId)
  const recent = useRecent()

  const categoryLabels = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c.label] as const)), [categories.data])
  const firstPage = (q: typeof nearby): BusinessSummary[] => (q.data?.pages[0]?.items ?? []).slice(0, SECTION_LIMIT)
  const loadingOf = (q: { isLoading: boolean }) => cityLoading || q.isLoading

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-8 p-4 md:p-6">
      <div className="flex flex-col gap-4">
        <PurposeCard />
        <SearchEntry />
      </div>

      {cityError && <ErrorState onRetry={refetchCity} />}

      {categories.isLoading ? (
        <div aria-hidden="true" className="flex gap-2 overflow-hidden">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-24 shrink-0" />
          ))}
        </div>
      ) : categories.isError ? (
        <ErrorState onRetry={() => void categories.refetch()} />
      ) : (categories.data ?? []).length > 0 ? (
        <CategoryRail categories={categories.data ?? []} hrefFor={categoryHref} />
      ) : null}

      {/* "Promoções do dia" só entra com campanhas reais (migration 0004). */}
      <BusinessSection
        title="Perto de você"
        subtitle="Distância estimada ao centro da cidade"
        moreTo="/restaurantes?sort=proximity"
        businesses={firstPage(nearby)}
        loading={loadingOf(nearby)}
        error={nearby.isError}
        onRetry={() => void nearby.refetch()}
        categoryLabels={categoryLabels}
      />
      <CommunityPreview />
      <BusinessSection
        title="Mais pedidos"
        subtitle="Os preferidos da cidade"
        moreTo="/restaurantes"
        businesses={firstPage(popular)}
        loading={loadingOf(popular)}
        error={popular.isError}
        onRetry={() => void popular.refetch()}
        categoryLabels={categoryLabels}
      />
      <BusinessSection
        title="Comerciantes em destaque"
        subtitle="Negócios locais que merecem sua atenção"
        moreTo="/explorar"
        businesses={(featured.data ?? []).slice(0, SECTION_LIMIT)}
        loading={loadingOf(featured)}
        error={featured.isError}
        onRetry={() => void featured.refetch()}
        categoryLabels={categoryLabels}
      />
      <RecentSection items={recent} />
    </div>
  )
}