/**
 * Dados estruturados (JSON-LD, Schema.org) e conteúdo visível sem JavaScript.
 * Só com dados reais do banco: sem avaliações, preços, horários ou salários inventados.
 */
import { SITE_NAME, type ShellLink } from './seo'

type Json = Record<string, unknown>

export const NAV_LINKS: ShellLink[] = [
  { href: '/restaurantes', label: 'Restaurantes e delivery' },
  { href: '/lojas', label: 'Lojas' },
  { href: '/servicos', label: 'Serviços' },
  { href: '/vagas', label: 'Vagas de emprego' },
]

export function organizationLd(siteUrl: string): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: siteUrl + '/',
    logo: siteUrl + '/brand/icone-1024.png',
    slogan: 'Tudo junto. Tudo aí.',
  }
}

export function websiteLd(siteUrl: string): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: siteUrl + '/',
    inLanguage: 'pt-BR',
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: siteUrl + '/busca?q={search_term_string}' },
      'query-input': 'required name=search_term_string',
    },
  }
}

export function breadcrumbLd(siteUrl: string, items: { name: string; path: string }[]): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Início', path: '/' }, ...items].map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: siteUrl + it.path,
    })),
  }
}

const httpsUrl = (u: string | null | undefined) => (u && /^https:\/\//i.test(u) ? u : undefined)
const compact = (o: Json): Json => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''))

export interface BusinessLdInput {
  name: string
  businessType: 'restaurante' | 'loja' | 'servico'
  description: string | null
  url: string
  addressLine: string | null
  cityName: string | null
  cityState: string | null
  phone: string | null
  image: string | null
}

export function businessLd(b: BusinessLdInput): Json {
  const address =
    b.cityName && b.cityState
      ? compact({ '@type': 'PostalAddress', streetAddress: b.addressLine ?? undefined, addressLocality: b.cityName, addressRegion: b.cityState, addressCountry: 'BR' })
      : undefined
  return compact({
    '@context': 'https://schema.org',
    '@type': b.businessType === 'restaurante' ? 'Restaurant' : b.businessType === 'loja' ? 'Store' : 'LocalBusiness',
    name: b.name,
    url: b.url,
    description: b.description ?? undefined,
    image: httpsUrl(b.image),
    telephone: b.phone ?? undefined,
    address,
  })
}

const EMPLOYMENT: Record<string, string> = {
  clt: 'FULL_TIME',
  pj: 'CONTRACTOR',
  temporario: 'TEMPORARY',
  estagio: 'INTERN',
  freelancer: 'CONTRACTOR',
  meio_periodo: 'PART_TIME',
}

export interface JobLdInput {
  title: string
  description: string
  employmentType: string
  workMode: string
  datePosted: string
  validThrough: string
  businessName: string
  businessUrl: string | null
  cityName: string | null
  cityState: string | null
  addressLine: string | null
}

/**
 * JobPosting só de vaga aberta e dentro da validade. Sem baseSalary: o cadastro não informa
 * o período do salário (mês, hora...), e o Google exige; não inventamos.
 */
export function jobLd(j: JobLdInput): Json {
  const remote = j.workMode === 'remoto'
  return compact({
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: j.title,
    description: j.description,
    datePosted: j.datePosted.slice(0, 10),
    validThrough: j.validThrough,
    employmentType: EMPLOYMENT[j.employmentType],
    directApply: true,
    hiringOrganization: compact({ '@type': 'Organization', name: j.businessName, sameAs: j.businessUrl ?? undefined }),
    jobLocationType: remote ? 'TELECOMMUTE' : undefined,
    applicantLocationRequirements: remote ? { '@type': 'Country', name: 'BR' } : undefined,
    jobLocation:
      !remote && j.cityName && j.cityState
        ? {
            '@type': 'Place',
            address: compact({ '@type': 'PostalAddress', streetAddress: j.addressLine ?? undefined, addressLocality: j.cityName, addressRegion: j.cityState, addressCountry: 'BR' }),
          }
        : undefined,
  })
}

/** JSON seguro dentro de <script type="application/ld+json"> (impede fechar a tag). */
export function ldScript(obj: Json): string {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')}</script>`
}
