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
import { DEFAULT_SITE_URL, robotsTxt, sitemapXml, type PageMeta, type SitemapEntry } from '../seo/seo'
import { SECURITY_HEADERS } from './securityHeaders'

export interface Env {
  ASSETS: { fetch(input: Request | string): Promise<Response> }
  /** Domínio canônico, sem barra final. Ex.: https://www.tucai.com.br */
  SITE_URL?: string
  /** "true" só no ambiente de produção. Qualquer outro valor: nada é indexado. */
  ALLOW_INDEXING?: string
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

/** Reescreve o index.html com os metadados da página. */
export function headTags(meta: PageMeta, siteUrl: string, indexable: boolean): string {
  const canonical = siteUrl + meta.canonicalPath
  return [
    `<link rel="canonical" href="${attr(canonical)}" />`,
    `<meta property="og:url" content="${attr(canonical)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:description" content="${attr(meta.description)}" />`,
    indexable ? '' : '<meta name="robots" content="noindex, nofollow" />',
  ].filter(Boolean).join('\n    ')
}

declare const HTMLRewriter: {
  new (): {
    on(selector: string, handlers: { element?(el: { setInnerContent(c: string): void; setAttribute(n: string, v: string): void; append(c: string, o?: { html: boolean }): void }): void }): InstanceType<typeof HTMLRewriter>
    transform(res: Response): Response
  }
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

    const { meta, redirect } = await resolvePage(path, supabaseRpc(env))
    if (redirect) return Response.redirect(new URL(redirect + url.search, url).toString(), 301)
    // barra final ou caixa diferente: uma única URL por página
    if (meta.status !== 404 && path !== meta.canonicalPath && path.replace(/\/+$/, '') === meta.canonicalPath) {
      return Response.redirect(new URL(meta.canonicalPath + url.search, url).toString(), 301)
    }

    const shell = await env.ASSETS.fetch(new Request(new URL('/', url).toString(), { headers: request.headers }))
    const index = indexingAllowed && meta.index
    const html = new HTMLRewriter()
      .on('title', { element: (el) => el.setInnerContent(meta.title) })
      .on('meta[name="description"]', { element: (el) => el.setAttribute('content', meta.description) })
      .on('meta[property="og:title"]', { element: (el) => el.setAttribute('content', meta.title) })
      .on('head', { element: (el) => el.append(headTags(meta, siteUrl, index), { html: true }) })
      .transform(shell)
    return withHeaders(new Response(html.body, { status: meta.status ?? 200, headers: shell.headers }), {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      ...(index ? {} : { 'X-Robots-Tag': 'noindex, nofollow' }),
    })
  },
}
