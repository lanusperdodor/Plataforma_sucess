/**
 * Worker da Tucaí (Cloudflare Workers + arquivos estáticos).
 *  * Arquivos (JS, CSS, imagens) saem direto do binding ASSETS.
 *  * Rotas do app recebem o index.html com HTTP 200 (antes davam 404) e com título, descrição,
 *    canonical e robots próprios da página, calculados a partir de dados PÚBLICOS do Supabase.
 *  * URLs inexistentes recebem 404 de verdade (com o app, que mostra "página não encontrada").
 *  * /robots.txt e /sitemap.xml gerados aqui; áreas privadas com noindex.
 *  * Nada de segredo: usa só a chave publicável, com as mesmas permissões de um visitante.
 */
import { SUPABASE_PUBLIC } from '../config/supabase-public'
import { resolvePage, type Rpc } from '../seo/resolve'
import { DEFAULT_SITE_URL, OG_IMAGE, robotsTxt, sitemapXml, type PageMeta, type SitemapEntry } from '../seo/seo'
import { ldScript } from '../seo/structured'
import { validGa4, validPixel } from '../features/tracking/config'
import { SECURITY_HEADERS } from './securityHeaders'
import { handleHealth } from './health'
import { handlePayments, type PaymentsEnv } from './payments'
import { handleRoutes, type RoutesEnv } from './routes'
import { handleFreight } from './freight'
import { handleCep } from './cep'
import { handleDiagnostics } from './diagnostics'

export interface Env extends PaymentsEnv, RoutesEnv {
  ASSETS: { fetch(input: Request | string): Promise<Response> }
  /** Domínio canônico, sem barra final. Ex.: https://www.tucai.com.br */
  SITE_URL?: string
  /** "true" só no ambiente de produção. Qualquer outro valor: nada é indexado. */
  ALLOW_INDEXING?: string
  /** ID de medição do GA4 (G-XXXX). Vazio = GA4 desligado. */
  GA4_ID?: string
  /** ID do Meta Pixel (só números). Vazio = Pixel desligado. */
  META_PIXEL_ID?: string
  SUPABASE_URL?: string
  SUPABASE_PUBLISHABLE_KEY?: string
}

function supabaseRpc(env: Env): Rpc {
  const base = (env.SUPABASE_URL || SUPABASE_PUBLIC.url).replace(/\/$/, '')
  const key = env.SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLIC.publishableKey
  return async <T>(fn: string, args: Record<string, unknown> = {}) => {
    try {
      const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: key, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        // cache curto na borda: metadados mudam pouco e o banco fica protegido de picos de robôs
        cf: { cacheTtl: 300, cacheEverything: true },
      } as RequestInit)
      if (!res.ok) return null
      return (await res.json()) as T
    } catch {
      return null
    }
  }
}

const isFilePath = (path: string) => path.startsWith('/assets/') || /\.[a-z0-9]{2,5}$/i.test(path.split('/').pop() ?? '')

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Tags de cabeçalho da página: canonical, Open Graph, Twitter/X, robots e JSON-LD. */
export function headTags(meta: PageMeta, siteUrl: string, indexable: boolean): string {
  const canonical = siteUrl + meta.canonicalPath
  const custom = meta.image && /^https:\/\//i.test(meta.image) ? meta.image : null
  const image = custom ?? siteUrl + OG_IMAGE.path
  return [
    `<link rel="canonical" href="${attr(canonical)}" />`,
    `<meta property="og:url" content="${attr(canonical)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:locale" content="pt_BR" />`,
    `<meta property="og:description" content="${attr(meta.description)}" />`,
    `<meta property="og:image" content="${attr(image)}" />`,
    custom ? '' : `<meta property="og:image:width" content="${OG_IMAGE.width}" />`,
    custom ? '' : `<meta property="og:image:height" content="${OG_IMAGE.height}" />`,
    `<meta property="og:image:alt" content="${attr(custom ? meta.title : OG_IMAGE.alt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${attr(meta.title)}" />`,
    `<meta name="twitter:description" content="${attr(meta.description)}" />`,
    `<meta name="twitter:image" content="${attr(image)}" />`,
    indexable ? '' : '<meta name="robots" content="noindex, nofollow" />',
    ...(indexable ? (meta.jsonLd ?? []).map(ldScript) : []),
  ].filter(Boolean).join('\n    ')
}

/** Conteúdo visível sem JavaScript (o React substitui o #root ao iniciar). */
export function shellHtml(meta: PageMeta): string {
  if (!meta.shell) return ''
  const links = meta.shell.links.map((l) => `<li><a href="${attr(l.href)}">${esc(l.label)}</a></li>`).join('')
  return `<div class="seo-shell"><h1>${esc(meta.shell.heading)}</h1><p>${esc(meta.shell.text)}</p>${links ? `<ul>${links}</ul>` : ''}</div>`
}

declare const HTMLRewriter: {
  new (): {
    on(selector: string, handlers: { element?(el: { setInnerContent(c: string): void; setAttribute(n: string, v: string): void; append(c: string, o?: { html: boolean }): void; remove(): void }): void }): InstanceType<typeof HTMLRewriter>
    transform(res: Response): Response
  }
}

/** CSP base + domínios estritamente necessários para cada ferramenta configurada. */
/**
 * Pedido do index.html base para montar a página. Sem cabeçalhos condicionais: se o navegador mandar
 * If-None-Match (ao atualizar), o ASSETS responderia 304 sem corpo e a página sairia em branco.
 */
export function shellRequest(request: Request, url: URL): Request {
  const headers = new Headers(request.headers)
  for (const h of ['if-none-match', 'if-modified-since', 'if-match', 'if-unmodified-since', 'if-range', 'range']) headers.delete(h)
  return new Request(new URL('/', url).toString(), { headers })
}

/** Cabeçalhos da página montada: sem ETag/Last-Modified/tamanho do arquivo base (o HTML muda por página). */
export function pageHeaders(shell: Headers): Headers {
  const headers = new Headers(shell)
  for (const h of ['etag', 'last-modified', 'content-length', 'content-range', 'accept-ranges']) headers.delete(h)
  return headers
}

export function cspFor(base: string, ga4: string | null, pixel: string | null): string {
  if (!ga4 && !pixel) return base
  const add: Record<string, string[]> = { 'script-src': [], 'connect-src': [], 'img-src': [] }
  if (ga4) {
    add['script-src']!.push('https://www.googletagmanager.com')
    add['connect-src']!.push('https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com')
  }
  if (pixel) {
    add['script-src']!.push('https://connect.facebook.net')
    add['connect-src']!.push('https://www.facebook.com', 'https://connect.facebook.net')
  }
  return base
    .split(';')
    .map((d) => {
      const name = d.trim().split(/\s+/)[0] ?? ''
      const extra = add[name]
      return extra && extra.length ? `${d.trim()} ${extra.join(' ')}` : d.trim()
    })
    .join('; ')
}

/** Metatags com os IDs públicos de medição (lidas pelo app; vazias não geram nada). */
export function trackingTags(ga4: string | null, pixel: string | null): string {
  return [ga4 ? `<meta name="tucai:ga4-id" content="${ga4}" />` : '', pixel ? `<meta name="tucai:meta-pixel-id" content="${pixel}" />` : ''].filter(Boolean).join('\n    ')
}

function withHeaders(res: Response, extra: Record<string, string>): Response {
  const out = new Response(res.body, res)
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) out.headers.set(k, v)
  return out
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const siteUrl = (env.SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, '')
    // Indexa só no domínio canônico de produção (homologação e domínio antigo ficam fora do Google)
    const indexingAllowed = env.ALLOW_INDEXING === 'true' && url.host === new URL(siteUrl).host
    const path = url.pathname

    const health = await handleHealth(request, env)
    if (health) return health
    const api = await handlePayments(request, env, siteUrl)
    if (api) return api
    const route = await handleRoutes(request, env)
    if (route) return route
    const freight = await handleFreight(request, env)
    if (freight) return freight
    const diag = await handleDiagnostics(request, env)
    if (diag) return withHeaders(diag, {})
    const cep = await handleCep(request)
    if (cep) return withHeaders(cep, {})
    if (path === '/robots.txt') {
      return withHeaders(new Response(robotsTxt(siteUrl, indexingAllowed), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }), {
        'Cache-Control': 'public, max-age=3600',
      })
    }
    if (path === '/sitemap.xml') {
      if (!indexingAllowed) return withHeaders(new Response('Not found', { status: 404 }), { 'X-Robots-Tag': 'noindex' })
      const entries = await supabaseRpc(env)<SitemapEntry[]>('sitemap_entries')
      if (entries === null) return withHeaders(new Response('Sitemap temporariamente indisponível', { status: 503 }), { 'Retry-After': '300' })
      return withHeaders(new Response(sitemapXml(siteUrl, entries), { headers: { 'Content-Type': 'application/xml; charset=utf-8' } }), {
        'Cache-Control': 'public, max-age=3600',
        'X-Robots-Tag': 'noindex',
      })
    }
    if (isFilePath(path)) return env.ASSETS.fetch(request)
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })

    const { meta, redirect } = await resolvePage(path, supabaseRpc(env), siteUrl)
    if (redirect) return Response.redirect(new URL(redirect + url.search, url).toString(), 301)
    // barra final ou caixa diferente: uma única URL por página
    if (meta.status !== 404 && path !== meta.canonicalPath && path.replace(/\/+$/, '') === meta.canonicalPath) {
      return Response.redirect(new URL(meta.canonicalPath + url.search, url).toString(), 301)
    }

    const ga4 = validGa4(env.GA4_ID)
    const pixel = validPixel(env.META_PIXEL_ID)
    const shell = await env.ASSETS.fetch(shellRequest(request, url))
    if (!shell.ok) return withHeaders(new Response('Serviço temporariamente indisponível', { status: 503, headers: { 'Retry-After': '30' } }), {})
    const index = indexingAllowed && meta.index
    const html = new HTMLRewriter()
      .on('title', { element: (el) => el.setInnerContent(meta.title) })
      .on('meta[name="description"]', { element: (el) => el.setAttribute('content', meta.description) })
      .on('meta[property="og:title"]', { element: (el) => el.setAttribute('content', meta.title) })
      // valores padrão do index.html: substituídos pelos da página (sem tags duplicadas)
      .on('meta[property="og:image"], meta[name="twitter:card"]', { element: (el) => el.remove() })
      .on('head', { element: (el) => el.append([headTags(meta, siteUrl, index), trackingTags(ga4, pixel)].filter(Boolean).join('\n    '), { html: true }) })
      .on('#boot .boot-box', { element: (el) => el.append(shellHtml(meta), { html: true }) })
      .transform(shell)
    return withHeaders(new Response(html.body, { status: meta.status ?? 200, headers: pageHeaders(shell.headers) }), {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': cspFor(SECURITY_HEADERS['Content-Security-Policy']!, ga4, pixel),
      'Cache-Control': 'public, max-age=0, must-revalidate',
      ...(index ? {} : { 'X-Robots-Tag': 'noindex, nofollow' }),
    })
  },
}
