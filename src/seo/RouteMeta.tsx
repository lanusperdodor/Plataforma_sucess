import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { seoRpc as rpc } from '../features/seo/repository'
import { resolvePage } from './resolve'
import { DEFAULT_SITE_URL, OG_IMAGE, matchRoute, type PageMeta } from './seo'

/** Domínio canônico: o mesmo que o Worker escreveu no HTML (ou o padrão). */
function canonicalBase(): string {
  const href = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href
  try {
    return href ? new URL(href).origin : DEFAULT_SITE_URL
  } catch {
    return DEFAULT_SITE_URL
  }
}

function upsert(selector: string, create: () => HTMLElement): HTMLElement {
  return document.head.querySelector<HTMLElement>(selector) ?? document.head.appendChild(create())
}

export function applyMeta(meta: PageMeta, base = canonicalBase()): void {
  document.title = meta.title
  const set = (selector: string, attrs: Record<string, string>, tag = 'meta') => {
    const el = upsert(selector, () => document.createElement(tag))
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  }
  set('meta[name="description"]', { name: 'description', content: meta.description })
  set('meta[property="og:title"]', { property: 'og:title', content: meta.title })
  set('meta[property="og:description"]', { property: 'og:description', content: meta.description })
  set('meta[property="og:url"]', { property: 'og:url', content: base + meta.canonicalPath })
  set('link[rel="canonical"]', { rel: 'canonical', href: base + meta.canonicalPath }, 'link')
  const image = meta.image && /^https:\/\//i.test(meta.image) ? meta.image : base + OG_IMAGE.path
  set('meta[property="og:image"]', { property: 'og:image', content: image })
  set('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' })
  set('meta[name="twitter:title"]', { name: 'twitter:title', content: meta.title })
  set('meta[name="twitter:description"]', { name: 'twitter:description', content: meta.description })
  set('meta[name="twitter:image"]', { name: 'twitter:image', content: image })
  // fora do domínio canônico (homologação, prévia) nunca indexa
  const noindex = !meta.index || window.location.origin !== base || import.meta.env.VITE_STATIC_PREVIEW === '1'
  const robots = document.head.querySelector('meta[name="robots"]')
  if (noindex) set('meta[name="robots"]', { name: 'robots', content: 'noindex, nofollow' })
  else robots?.remove()
  // dados estruturados da página atual (os da página anterior saem)
  document.head.querySelectorAll('script[type="application/ld+json"]').forEach((el) => el.remove())
  if (!noindex)
    for (const obj of meta.jsonLd ?? []) {
      const el = document.createElement('script')
      el.type = 'application/ld+json'
      el.textContent = JSON.stringify(obj)
      document.head.appendChild(el)
    }
}

// Caminho do primeiro carregamento: o Worker já escreveu os metadados certos no HTML.
const initialPath = typeof window === 'undefined' ? '' : window.location.pathname

/** Atualiza título, descrição, canonical e robots a cada mudança de rota (sem recarregar). */
export function RouteMeta() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const kind = matchRoute(pathname).kind
  const needsData = kind === 'business' || kind === 'job' || kind === 'city'
  const q = useQuery({ queryKey: ['seo', pathname], queryFn: () => resolvePage(pathname, rpc, canonicalBase()), staleTime: 5 * 60_000 })
  useEffect(() => {
    if (!q.data) return
    if (q.data.redirect) {
      navigate(q.data.redirect + search, { replace: true })
      return
    }
    // banco indisponível no primeiro carregamento: mantém o que veio do servidor
    if (q.data.unavailable && pathname === initialPath) return
    applyMeta(q.data.meta)
  }, [q.data, navigate, search, pathname])
  // rotas fixas aplicam na hora, sem esperar a consulta
  useEffect(() => {
    if (needsData) return
    void resolvePage(pathname, rpc, canonicalBase()).then((r) => applyMeta(r.meta))
  }, [pathname, needsData])
  return null
}
