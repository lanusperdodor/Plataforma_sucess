import { ArrowRight, Bike, Briefcase, Compass, ShoppingBag, Users, UtensilsCrossed, Wrench, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { BusinessCard } from '../components/cards/BusinessCard.tsx'
import { SkeletonCard } from '../components/feedback/Skeleton.tsx'
import { CategoryRail } from '../components/nav/CategoryRail.tsx'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { Section } from '../components/nav/Section.tsx'
import { useBusinesses, useCategories, useFeatured } from '../features/catalog/hooks.ts'
import { useCurrentCity } from '../features/location/cityStore.ts'
import { categoryHref } from './HomePage.tsx'

interface Area {
  to: string
  title: string
  text: string
  icon: LucideIcon
  count?: number
  accent?: boolean
}

function AreaTile({ area }: { area: Area }) {
  const Icon = area.icon
  return (
    <Link
      to={area.to}
      className={`hover-lift pressable group flex min-h-32 flex-col justify-between gap-3 rounded-card border p-4 ${
        area.accent ? 'border-orange bg-orange text-ink' : 'border-line bg-surface text-ink'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span aria-hidden="true" className={`grid size-11 place-items-center rounded-2xl ${area.accent ? 'bg-ink text-orange' : 'bg-brand text-orange'}`}>
          <Icon className="size-5" />
        </span>
        {area.count !== undefined && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${area.accent ? 'bg-ink/10' : 'bg-muted text-ink-muted'}`}>
            {area.count}
          </span>
        )}
      </div>
      <div>
        <p className="flex items-center gap-1 text-base font-bold">
          {area.title}
          <ArrowRight aria-hidden="true" className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        </p>
        <p className={`text-sm ${area.accent ? 'text-ink' : 'text-ink-muted'}`}>{area.text}</p>
      </div>
    </Link>
  )
}

/** Explorar: porta de entrada para todas as áreas da cidade. */
export function ExplorePage() {
  const { city } = useCurrentCity()
  const restaurants = useBusinesses(city?.id, 'restaurante')
  const stores = useBusinesses(city?.id, 'loja')
  const services = useBusinesses(city?.id, 'servico')
  const featured = useFeatured(city?.id)
  const categories = useCategories()

  const areas: Area[] = [
    { to: '/restaurantes', title: 'Restaurantes', text: 'Delivery e retirada', icon: UtensilsCrossed, count: restaurants.data?.length, accent: true },
    { to: '/lojas', title: 'Lojas', text: 'Farmácia, moda, calçados', icon: ShoppingBag, count: stores.data?.length },
    { to: '/servicos', title: 'Serviços', text: 'Profissionais da região', icon: Wrench, count: services.data?.length },
    { to: '/vagas', title: 'Vagas', text: 'Oportunidades perto de você', icon: Briefcase },
    { to: '/conectuai', title: 'Conectuaí', text: 'A rede social da região', icon: Users },
  ]

  return (
    <Page>
      <PageHeader icon={Compass} title="Explorar" subtitle={`Tudo o que ${city?.name ?? 'a sua cidade'} tem, num só lugar.`} />
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {areas.map((a) => (
          <li key={a.to} className={a.accent ? 'col-span-2 md:col-span-1' : ''}>
            <AreaTile area={a} />
          </li>
        ))}
      </ul>
      <section aria-labelledby="explorar-parceiros" className="flex flex-col gap-3">
        <h2 id="explorar-parceiros" className="text-lg font-semibold text-ink">Seja parceiro da Tucaí</h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <li>
            <AreaTile area={{ to: '/entregadores', title: 'Entregadores', text: 'Faça entregas como parceiro independente', icon: Bike }} />
          </li>
          <li>
            <AreaTile area={{ to: '/cadastrar-negocio', title: 'Cadastrar negócio', text: 'Restaurante, loja ou serviço', icon: ShoppingBag }} />
          </li>
        </ul>
      </section>
      {(categories.data ?? []).length > 0 && (
        <section aria-labelledby="explorar-cat" className="flex flex-col gap-3">
          <h2 id="explorar-cat" className="text-lg font-semibold text-ink">Navegue por categoria</h2>
          <CategoryRail categories={categories.data ?? []} hrefFor={categoryHref} />
        </section>
      )}
      <Section title="Em alta na cidade" subtitle="Os mais procurados agora" moreTo="/restaurantes" variant="carousel" empty={!featured.isLoading && (featured.data ?? []).length === 0} hideWhenEmpty>
        {featured.isLoading
          ? Array.from({ length: 3 }, (_, i) => <SkeletonCard key={i} />)
          : (featured.data ?? []).map((b) => <BusinessCard key={b.id} business={b} />)}
      </Section>
    </Page>
  )
}