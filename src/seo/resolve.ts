/** Resolve os metadados de uma URL a partir de dados públicos (mesma lógica no Worker e no app). */
import {
  TYPE_SECTION,
  businessMeta,
  cityMeta,
  jobMeta,
  matchRoute,
  noindexMeta,
  notFoundMeta,
  privateMeta,
  staticMeta,
  DEFAULT_SITE_URL,
  type BusinessKind,
  type PageMeta,
  type Section,
} from './seo'
import { NAV_LINKS, breadcrumbLd, businessLd, jobLd, organizationLd, websiteLd } from './structured'

const SECTION_NAME: Record<Section | 'vagas', string> = { restaurantes: 'Restaurantes', lojas: 'Lojas', servicos: 'Serviços', vagas: 'Vagas' }

interface BusinessRow {
  name: string
  business_type: BusinessKind
  description: string | null
  city_name: string | null
  city_state: string | null
  city_slug: string | null
  indexable: boolean
  address_line: string | null
  phone: string | null
  logo_url: string | null
  cover_url: string | null
}
interface JobRow {
  title: string
  business_name: string
  city_name: string | null
  city_state: string | null
  description: string
  employment_type: string
  work_mode: string
  created_at: string
  expires_at: string
  business_slug: string
  business_type: BusinessKind
  address_line: string | null
}
interface CityRow {
  name: string
  state: string
  slug: string
  restaurantes: number
  lojas: number
  servicos: number
  vagas: number
}

/** Acrescenta JSON-LD e conteúdo visível sem JS aos metadados básicos. */
function enrich(meta: PageMeta, extra: Partial<PageMeta>): PageMeta {
  return { ...meta, ...extra }
}

/** Chamada a uma função pública do banco; null = banco indisponível. */
export type Rpc = <T>(fn: string, args?: Record<string, unknown>) => Promise<T | null>


export interface Resolved {
  meta: PageMeta
  redirect?: string
  /** O banco não respondeu: meta provisória (não indexa e não afirma 404). */
  unavailable?: boolean
}

/** Metadados da página (ou redirecionamento canônico) para um caminho. */
export async function resolvePage(pathname: string, rpc: Rpc, siteUrl: string = DEFAULT_SITE_URL): Promise<Resolved> {
  const m = matchRoute(pathname)
  switch (m.kind) {
    case 'static': {
      const meta = staticMeta(m.path)!
      const shell = { heading: meta.title.replace(/ \| Tucaí$/, ''), text: meta.description, links: NAV_LINKS }
      if (m.path === '/') return { meta: enrich(meta, { shell: { ...shell, heading: 'Tucaí — Tudo junto. Tudo aí.' }, jsonLd: [organizationLd(siteUrl), websiteLd(siteUrl)] }) }
      const name = SECTION_NAME[m.path.slice(1) as Section | 'vagas']
      return { meta: enrich(meta, { shell, jsonLd: name ? [breadcrumbLd(siteUrl, [{ name, path: m.path }])] : undefined }) }
    }
    case 'private':
      return { meta: privateMeta(m.path) }
    case 'noindex':
      return { meta: noindexMeta(m.path) }
    case 'notfound':
      return { meta: notFoundMeta(m.path) }
    case 'business': {
      const rows = await rpc<BusinessRow[]>('seo_business', { _slug: m.slug })
      if (rows === null) return { meta: { ...notFoundMeta(pathname), status: 200, index: false }, unavailable: true } // banco indisponível: não afirma 404
      const b = rows[0]
      if (!b) return { meta: notFoundMeta(pathname) }
      const right = TYPE_SECTION[b.business_type]
      if (right !== m.section) return { meta: notFoundMeta(pathname), redirect: `/${right}/${m.slug}` }
      const meta = businessMeta({ name: b.name, businessType: b.business_type, description: b.description, cityName: b.city_name, cityState: b.city_state, indexable: b.indexable }, m.slug)
      const url = siteUrl + meta.canonicalPath
      const image = b.cover_url ?? b.logo_url
      const where = b.city_name && b.city_state ? `${b.city_name}, ${b.city_state}` : null
      return {
        meta: enrich(meta, {
          image: image && /^https:\/\//i.test(image) ? image : undefined,
          shell: {
            heading: b.name,
            text: meta.description,
            links: [
              { href: `/${right}`, label: `Ver ${SECTION_NAME[right].toLowerCase()}` },
              ...(b.city_slug && where ? [{ href: `/cidades/${b.city_slug}`, label: `Comércio de ${where}` }] : []),
            ],
          },
          jsonLd: b.indexable
            ? [
                businessLd({ name: b.name, businessType: b.business_type, description: b.description, url, addressLine: b.address_line, cityName: b.city_name, cityState: b.city_state, phone: b.phone, image }),
                breadcrumbLd(siteUrl, [{ name: SECTION_NAME[right], path: `/${right}` }, { name: b.name, path: meta.canonicalPath }]),
              ]
            : undefined,
        }),
      }
    }
    case 'job': {
      const rows = await rpc<JobRow[]>('seo_job', { _id: m.id })
      if (rows === null) return { meta: { ...notFoundMeta(pathname), status: 200, index: false }, unavailable: true }
      const j = rows[0]
      // vaga encerrada/expirada: a página do app explica; não indexa
      if (!j) return { meta: { title: 'Vaga indisponível | Tucaí', description: 'Esta vaga foi encerrada ou expirou.', index: false, canonicalPath: `/vagas/${m.id}`, status: 404 } }
      const meta = jobMeta({ title: j.title, businessName: j.business_name, cityName: j.city_name, cityState: j.city_state }, m.id)
      const businessPath = `/${TYPE_SECTION[j.business_type]}/${j.business_slug}`
      return {
        meta: enrich(meta, {
          shell: { heading: j.title, text: meta.description, links: [{ href: '/vagas', label: 'Ver todas as vagas' }, { href: businessPath, label: j.business_name }] },
          jsonLd: [
            jobLd({
              title: j.title, description: j.description, employmentType: j.employment_type, workMode: j.work_mode, datePosted: j.created_at,
              validThrough: j.expires_at, businessName: j.business_name, businessUrl: siteUrl + businessPath, cityName: j.city_name,
              cityState: j.city_state, addressLine: j.address_line,
            }),
            breadcrumbLd(siteUrl, [{ name: 'Vagas', path: '/vagas' }, { name: j.title, path: meta.canonicalPath }]),
          ],
        }),
      }
    }
    case 'city': {
      const rows = await rpc<CityRow[]>('seo_city', { _slug: m.slug })
      if (rows === null) return { meta: { ...notFoundMeta(pathname), status: 200, index: false }, unavailable: true }
      const c = rows[0]
      if (!c) return { meta: notFoundMeta(pathname) }
      const meta = cityMeta(c, m.section)
      const base = `/cidades/${c.slug}`
      const place = `${c.name}, ${c.state}`
      const counts: Record<Section | 'vagas', number> = { restaurantes: c.restaurantes, lojas: c.lojas, servicos: c.servicos, vagas: c.vagas }
      const links = (Object.keys(counts) as (Section | 'vagas')[])
        .filter((k) => counts[k] > 0 && k !== m.section)
        .map((k) => ({ href: `${base}/${k}`, label: `${SECTION_NAME[k]} em ${c.name}` }))
      const crumbs = [{ name: place, path: base }, ...(m.section ? [{ name: SECTION_NAME[m.section], path: `${base}/${m.section}` }] : [])]
      return {
        meta: enrich(meta, {
          shell: { heading: meta.title.replace(/ \| Tucaí$/, ''), text: meta.description, links },
          jsonLd: meta.index ? [breadcrumbLd(siteUrl, crumbs)] : undefined,
        }),
      }
    }
  }
}

