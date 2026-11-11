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
  type BusinessKind,
  type PageMeta,
} from './seo'

/** Chamada a uma função pública do banco; null = banco indisponível. */
export type Rpc = <T>(fn: string, args?: Record<string, unknown>) => Promise<T | null>


export interface Resolved {
  meta: PageMeta
  redirect?: string
  /** O banco não respondeu: meta provisória (não indexa e não afirma 404). */
  unavailable?: boolean
}

/** Metadados da página (ou redirecionamento canônico) para um caminho. */
export async function resolvePage(pathname: string, rpc: Rpc): Promise<Resolved> {
  const m = matchRoute(pathname)
  switch (m.kind) {
    case 'static':
      return { meta: staticMeta(m.path)! }
    case 'private':
      return { meta: privateMeta(m.path) }
    case 'noindex':
      return { meta: noindexMeta(m.path) }
    case 'notfound':
      return { meta: notFoundMeta(m.path) }
    case 'business': {
      const rows = await rpc<{ name: string; business_type: BusinessKind; description: string | null; city_name: string | null; city_state: string | null; indexable: boolean }[]>(
        'seo_business',
        { _slug: m.slug },
      )
      if (rows === null) return { meta: { ...notFoundMeta(pathname), status: 200, index: false }, unavailable: true } // banco indisponível: não afirma 404
      const b = rows[0]
      if (!b) return { meta: notFoundMeta(pathname) }
      const right = TYPE_SECTION[b.business_type]
      if (right !== m.section) return { meta: notFoundMeta(pathname), redirect: `/${right}/${m.slug}` }
      return { meta: businessMeta({ name: b.name, businessType: b.business_type, description: b.description, cityName: b.city_name, cityState: b.city_state, indexable: b.indexable }, m.slug) }
    }
    case 'job': {
      const rows = await rpc<{ title: string; business_name: string; city_name: string | null; city_state: string | null }[]>('seo_job', { _id: m.id })
      if (rows === null) return { meta: { ...notFoundMeta(pathname), status: 200, index: false }, unavailable: true }
      const j = rows[0]
      // vaga encerrada/expirada: a página do app explica; não indexa
      if (!j) return { meta: { title: 'Vaga indisponível | Tucaí', description: 'Esta vaga foi encerrada ou expirou.', index: false, canonicalPath: `/vagas/${m.id}`, status: 404 } }
      return { meta: jobMeta({ title: j.title, businessName: j.business_name, cityName: j.city_name, cityState: j.city_state }, m.id) }
    }
    case 'city': {
      const rows = await rpc<{ name: string; state: string; slug: string; restaurantes: number; lojas: number; servicos: number; vagas: number }[]>('seo_city', { _slug: m.slug })
      if (rows === null) return { meta: { ...notFoundMeta(pathname), status: 200, index: false }, unavailable: true }
      const c = rows[0]
      if (!c) return { meta: notFoundMeta(pathname) }
      return { meta: cityMeta(c, m.section) }
    }
  }
}

