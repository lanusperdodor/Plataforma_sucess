/**
 * SEO da Tucaí: classificação de rotas, títulos/descrições, canonical, robots.txt e sitemap.xml.
 * Módulo puro (sem DOM e sem React): usado pelo Worker na borda e pelo app no navegador,
 * para que o HTML entregue ao buscador e o título da aba sejam sempre os mesmos.
 */

export const SITE_NAME = 'Tucaí'
/** Domínio canônico padrão enquanto não houver domínio próprio (configurável no Worker por SITE_URL). */
export const DEFAULT_SITE_URL = 'https://plataforma-sucess.marcossonopi.workers.dev'

export type Section = 'restaurantes' | 'lojas' | 'servicos'
export const SECTIONS: readonly Section[] = ['restaurantes', 'lojas', 'servicos']
export const SECTION_TYPE = { restaurantes: 'restaurante', lojas: 'loja', servicos: 'servico' } as const
export const TYPE_SECTION = { restaurante: 'restaurantes', loja: 'lojas', servico: 'servicos' } as const
export type BusinessKind = keyof typeof TYPE_SECTION

/** Imagem padrão de compartilhamento (1200×630), feita com o logo e o mascote oficiais. */
export const OG_IMAGE = { path: '/brand/og-tucai.jpg', width: 1200, height: 630, alt: 'Tucaí — Tudo junto. Tudo aí. Delivery, lojas, serviços e vagas da sua cidade.' }

export interface ShellLink {
  href: string
  label: string
}

/** Conteúdo visível no HTML para quem não executa JavaScript (o React substitui ao iniciar). */
export interface PageShell {
  heading: string
  text: string
  links: ShellLink[]
}

export interface PageMeta {
  title: string
  description: string
  /** Imagem de compartilhamento: URL absoluta https ou caminho do site. Padrão: OG_IMAGE. */
  image?: string
  /** Objetos Schema.org (JSON-LD), só com dados reais. */
  jsonLd?: Record<string, unknown>[]
  shell?: PageShell
  /** false = <meta name="robots" content="noindex"> e X-Robots-Tag. */
  index: boolean
  /** Caminho canônico (sem domínio e sem query). */
  canonicalPath: string
  /** Status HTTP sugerido para a resposta do HTML. */
  status?: 200 | 404
}

export type RouteMatch =
  | { kind: 'static'; path: string }
  | { kind: 'business'; section: Section; slug: string }
  | { kind: 'job'; id: string }
  | { kind: 'city'; slug: string; section: Section | 'vagas' | null }
  | { kind: 'noindex'; path: string } // páginas públicas sem valor de busca ou com conteúdo de pessoas
  | { kind: 'private'; path: string } // exigem login ou são técnicas
  | { kind: 'notfound'; path: string }

const STATIC: Record<string, Omit<PageMeta, 'canonicalPath' | 'index'>> = {
  '/': {
    title: 'Tucaí | Delivery, Lojas e Serviços Perto de Você',
    description: 'Descubra restaurantes, lojas, serviços e oportunidades da sua região com a Tucaí. Tudo junto. Tudo aí.',
  },
  '/restaurantes': {
    title: 'Restaurantes e Delivery na sua Região | Tucaí',
    description: 'Encontre restaurantes, lanches, pizzarias e opções de delivery em cidades atendidas pela Tucaí.',
  },
  '/lojas': {
    title: 'Lojas e Produtos da Região | Tucaí',
    description: 'Explore lojas locais, roupas, calçados, acessórios e produtos de estabelecimentos da sua região.',
  },
  '/servicos': {
    title: 'Serviços Perto de Você | Tucaí',
    description: 'Encontre profissionais e serviços disponíveis na sua cidade pela Tucaí.',
  },
  '/vagas': {
    title: 'Vagas de Emprego na sua Região | Tucaí',
    description: 'Encontre oportunidades de emprego divulgadas por empresas da região na Tucaí.',
  },
  '/entregadores': {
    title: 'Seja Entregador Parceiro | Tucaí',
    description: 'Cadastre-se como entregador parceiro da Tucaí e faça entregas para o comércio da sua cidade.',
  },
  '/cadastrar-negocio': {
    title: 'Cadastre seu Restaurante, Loja ou Serviço | Tucaí',
    description: 'Coloque seu negócio na Tucaí e venda para clientes da sua região, com pedidos, entrega e retirada.',
  },
  '/privacidade': {
    title: 'Política de Privacidade | Tucaí',
    description: 'Como a Tucaí trata seus dados pessoais, seus direitos e como exercê-los.',
  },
  '/termos': {
    title: 'Termos de Uso | Tucaí',
    description: 'Regras de uso da Tucaí para consumidores, estabelecimentos, entregadores e prestadores de serviço.',
  },
}

const NOINDEX: Record<string, string> = {
  '/busca': 'Busca',
  '/explorar': 'Explorar',
  '/armazenamento': 'Armazenamento local',
}

const PRIVATE_PREFIXES = [
  '/entrar', '/cadastro', '/recuperar-senha', '/nova-senha', '/conta', '/perfil', '/sacola', '/pedidos', '/notificacoes',
  '/painel', '/entregador', '/admin', '/vagas/minhas-candidaturas',
]
const NOINDEX_PREFIXES = ['/conectuai', '/conecta', '/comunidade']

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const startsWithSegment = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + '/')

/** Normaliza o caminho: sem barra final (exceto "/"), sem query/hash. */
export function normalizePath(pathname: string): string {
  const p = pathname.split(/[?#]/)[0] || '/'
  return p.length > 1 ? p.replace(/\/+$/, '') || '/' : '/'
}

export function matchRoute(pathname: string): RouteMatch {
  const path = normalizePath(pathname)
  if (STATIC[path]) return { kind: 'static', path }
  if (NOINDEX[path]) return { kind: 'noindex', path }
  if (PRIVATE_PREFIXES.some((p) => startsWithSegment(path, p))) return { kind: 'private', path }
  if (NOINDEX_PREFIXES.some((p) => startsWithSegment(path, p))) return { kind: 'noindex', path }
  const parts = path.split('/').filter(Boolean)
  const [a, b, c] = parts
  if (parts.length === 2 && (SECTIONS as readonly string[]).includes(a!) && SLUG.test(b!)) return { kind: 'business', section: a as Section, slug: b! }
  if (parts.length === 2 && a === 'vagas' && UUID.test(b!)) return { kind: 'job', id: b!.toLowerCase() }
  if (a === 'cidades' && b && SLUG.test(b)) {
    if (parts.length === 2) return { kind: 'city', slug: b, section: null }
    if (parts.length === 3 && ((SECTIONS as readonly string[]).includes(c!) || c === 'vagas')) return { kind: 'city', slug: b, section: c as Section | 'vagas' }
  }
  return { kind: 'notfound', path }
}

/** Corta em limite de palavra para caber em resultados de busca (~155 caracteres). */
export function clip(text: string, max = 155): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).replace(/[\s,.;:–-]+$/, '') + '…'
}

export function staticMeta(path: string): PageMeta | null {
  const m = STATIC[path]
  return m ? { ...m, index: true, canonicalPath: path } : null
}

export function privateMeta(path: string): PageMeta {
  return { title: SITE_NAME, description: STATIC['/']!.description, index: false, canonicalPath: path }
}

export function noindexMeta(path: string): PageMeta {
  const label = NOINDEX[path]
  return { title: label ? `${label} | Tucaí` : SITE_NAME, description: STATIC['/']!.description, index: false, canonicalPath: path }
}

export function notFoundMeta(path: string): PageMeta {
  return { title: 'Página não encontrada | Tucaí', description: 'Esta página não existe na Tucaí.', index: false, canonicalPath: path, status: 404 }
}

const where = (city: string | null, state: string | null) => (city && state ? ` em ${city}, ${state}` : '')

export interface BusinessSeo {
  name: string
  businessType: BusinessKind
  description: string | null
  cityName: string | null
  cityState: string | null
  indexable: boolean
}

export function businessMeta(b: BusinessSeo, slug: string): PageMeta {
  const section = TYPE_SECTION[b.businessType]
  const lead =
    b.businessType === 'restaurante'
      ? `Veja o cardápio de ${b.name}${where(b.cityName, b.cityState)} e peça pela Tucaí.`
      : b.businessType === 'loja'
        ? `Conheça os produtos de ${b.name}${where(b.cityName, b.cityState)} na Tucaí.`
        : `Conheça os serviços de ${b.name}${where(b.cityName, b.cityState)} na Tucaí.`
  return {
    title: `${b.name}${where(b.cityName, b.cityState)} | Tucaí`,
    description: clip(b.description ? `${b.description} ${lead}` : lead),
    index: b.indexable,
    canonicalPath: `/${section}/${slug}`,
  }
}

export interface CitySeo {
  name: string
  state: string
  slug: string
  restaurantes: number
  lojas: number
  servicos: number
  vagas: number
}

const SECTION_TITLE: Record<Section | 'vagas', string> = {
  restaurantes: 'Restaurantes e Delivery',
  lojas: 'Lojas',
  servicos: 'Serviços',
  vagas: 'Vagas de Emprego',
}
const SECTION_DESC: Record<Section | 'vagas', (place: string) => string> = {
  restaurantes: (p) => `Restaurantes, lanchonetes e delivery em ${p}. Veja cardápios e peça pela Tucaí.`,
  lojas: (p) => `Lojas e produtos do comércio local de ${p}. Compre na sua cidade pela Tucaí.`,
  servicos: (p) => `Serviços e profissionais em ${p} na Tucaí.`,
  vagas: (p) => `Vagas de emprego abertas por empresas de ${p} na Tucaí.`,
}

/** Título e descrição da cidade: só menciona o que existe de verdade nela. */
export function cityMeta(c: CitySeo, section: Section | 'vagas' | null): PageMeta {
  const place = `${c.name}, ${c.state}`
  const counts: Record<Section | 'vagas', number> = { restaurantes: c.restaurantes, lojas: c.lojas, servicos: c.servicos, vagas: c.vagas }
  const base = `/cidades/${c.slug}`
  if (section) {
    const has = counts[section] > 0
    return {
      title: `${SECTION_TITLE[section]} em ${place} | Tucaí`,
      description: has ? SECTION_DESC[section](place) : `Ainda não há ${SECTION_TITLE[section].toLowerCase()} ativos na Tucaí em ${place}.`,
      index: has,
      canonicalPath: `${base}/${section}`,
    }
  }
  const present = (Object.keys(counts) as (Section | 'vagas')[]).filter((k) => counts[k] > 0)
  if (present.length === 0) {
    return {
      title: `${place} | Tucaí`,
      description: `A Tucaí ainda não tem estabelecimentos ativos em ${place}.`,
      index: false,
      canonicalPath: base,
    }
  }
  const names = present.map((k) => (k === 'restaurantes' ? 'Delivery' : SECTION_TITLE[k]))
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names.at(-1)}` : names[0]
  return {
    title: `${list} em ${place} | Tucaí`,
    description: clip(`Comércio local de ${place} na Tucaí: ${present.map((k) => SECTION_TITLE[k].toLowerCase()).join(', ')}. Tudo junto. Tudo aí.`),
    index: true,
    canonicalPath: base,
  }
}

export interface JobSeo {
  title: string
  businessName: string
  cityName: string | null
  cityState: string | null
}

export function jobMeta(j: JobSeo, id: string): PageMeta {
  return {
    title: `${j.title} — ${j.businessName}${where(j.cityName, j.cityState)} | Vagas Tucaí`,
    description: clip(`Vaga de ${j.title} em ${j.businessName}${where(j.cityName, j.cityState)}. Veja os detalhes e candidate-se pela Tucaí.`),
    index: true,
    canonicalPath: `/vagas/${id}`,
  }
}

// ---------- robots.txt e sitemap.xml ----------

export function robotsTxt(siteUrl: string, allowIndexing: boolean): string {
  if (!allowIndexing) return ['# Ambiente sem indexação (homologação ou domínio não canônico).', 'User-agent: *', 'Disallow: /', ''].join('\n')
  const disallow = [...PRIVATE_PREFIXES, '/busca', '/conectuai', '/conecta', '/comunidade']
  return [
    '# Tucaí — Tudo junto. Tudo aí.',
    '# Áreas privadas também respondem com noindex; robots.txt não é mecanismo de segurança.',
    'User-agent: *',
    // "$" e "/" evitam bloquear vizinhas (ex.: /entregador não pode bloquear /entregadores)
    ...disallow.flatMap((p) => [`Disallow: ${p}$`, `Disallow: ${p}/`]),
    'Allow: /',
    '',
    `Sitemap: ${siteUrl}/sitemap.xml`,
    '',
  ].join('\n')
}

export interface SitemapEntry {
  path: string
  lastmod: string | null
}

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** Páginas institucionais sempre presentes (têm conteúdo próprio, independente de cadastros). */
export const ALWAYS_IN_SITEMAP = ['/', '/entregadores', '/cadastrar-negocio', '/privacidade', '/termos']

export function sitemapXml(siteUrl: string, entries: SitemapEntry[]): string {
  const seen = new Set<string>()
  const all = [...ALWAYS_IN_SITEMAP.map((path) => ({ path, lastmod: null })), ...entries].filter((e) => {
    const p = normalizePath(e.path)
    if (seen.has(p)) return false
    seen.add(p)
    return true
  })
  const urls = all.map((e) => {
    const lastmod = e.lastmod ? `<lastmod>${new Date(e.lastmod).toISOString().slice(0, 10)}</lastmod>` : ''
    return `  <url><loc>${xmlEscape(siteUrl + normalizePath(e.path))}</loc>${lastmod}</url>`
  })
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''].join('\n')
}
