import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { NotFoundState } from '../components/feedback/NotFoundState.tsx'
import { Page } from '../components/nav/PageHeader.tsx'
import { useCities } from '../features/catalog/hooks.ts'
import { setStoredCityId, useCity } from '../features/location/cityStore.ts'
import { BusinessListing } from './BusinessListing.tsx'
import { HomePage } from './HomePage.tsx'
import { JobsPage } from './JobsPage.tsx'
import { RestaurantsPage } from './RestaurantsPage.tsx'
import { Store, Wrench } from 'lucide-react'

const SECTIONS = ['restaurantes', 'lojas', 'servicos', 'vagas'] as const
type CitySection = (typeof SECTIONS)[number]

/**
 * Página da cidade (/cidades/:slug e /cidades/:slug/:secao): endereço próprio para busca regional.
 * Abrir a URL escolhe a cidade no seletor e mostra o conteúdo real dela.
 */
export function CityPage() {
  const { slug = '', section } = useParams()
  const cities = useCities()
  const [storedId] = useCity()
  const city = (cities.data ?? []).find((c) => c.slug === slug)
  const valid = !section || (SECTIONS as readonly string[]).includes(section)

  useEffect(() => {
    if (city && storedId !== city.id) setStoredCityId(city.id)
  }, [city, storedId])

  if (cities.isLoading) return <Page><p role="status" className="text-sm text-ink-muted">Carregando…</p></Page>
  if (!city || !valid) {
    return <Page><NotFoundState title="Cidade não encontrada" description="Esta cidade não é atendida pela Tucaí ou o endereço está incorreto." /></Page>
  }
  if (storedId !== city.id) return <Page><p role="status" className="text-sm text-ink-muted">Carregando {city.name}…</p></Page>
  switch (section as CitySection | undefined) {
    case 'restaurantes':
      return <RestaurantsPage />
    case 'lojas':
      return <BusinessListing type="loja" title={`Lojas em ${city.name}`} subtitle="Comércio local da sua cidade." icon={Store} />
    case 'servicos':
      return <BusinessListing type="servico" title={`Serviços em ${city.name}`} subtitle="Profissionais e serviços da sua cidade." icon={Wrench} />
    case 'vagas':
      return <JobsPage />
    default:
      return <HomePage />
  }
}
