import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { matchPath } from 'react-router-dom'

type Loader<M> = () => Promise<M>

/** Adapta exportações nomeadas ao `React.lazy` (que exige `default`). */
export function lazyNamed<M extends Record<string, unknown>, K extends keyof M>(
  loader: Loader<M>,
  exportName: K,
): LazyExoticComponent<M[K] extends ComponentType<infer P> ? ComponentType<P> : never> {
  return lazy(async () => {
    const mod = await loader()
    return { default: mod[exportName] as never }
  })
}

/** Carregadores por padrão de rota; compartilhados com o prefetch. */
export const pageLoaders = {
  '/': () => import('../pages/HomePage.tsx'),
  '/explorar': () => import('../pages/ExplorePage.tsx'),
  '/restaurantes': () => import('../pages/RestaurantsPage.tsx'),
  '/restaurantes/:slug': () => import('../pages/BusinessPage.tsx'),
  '/lojas': () => import('../pages/StoresPage.tsx'),
  '/lojas/:slug': () => import('../pages/BusinessPage.tsx'),
  '/servicos/:slug': () => import('../pages/BusinessPage.tsx'),
  '/servicos': () => import('../pages/ServicesPage.tsx'),
  '/vagas': () => import('../pages/JobsPage.tsx'),
  '/vagas/:id': () => import('../pages/JobPage.tsx'),
  '/conecta': () => import('../pages/ConectaPage.tsx'),
  '/conecta/:postId': () => import('../pages/PostPage.tsx'),
  '/conecta/u/:handle': () => import('../pages/ConectaProfilePage.tsx'),
  '/entregadores': () => import('../pages/CouriersPage.tsx'),
  '/privacidade': () => import('../pages/legal/LegalPages.tsx'),
  '/perfil/privacidade': () => import('../pages/PrivacyCenterPage.tsx'),
  '/cadastrar-negocio': () => import('../pages/BusinessApplicationPage.tsx'),
  '/busca': () => import('../pages/SearchPage.tsx'),
  '/sacola': () => import('../pages/CartPage.tsx'),
  '/sacola/checkout': () => import('../pages/CheckoutPage.tsx'),
  '/pedidos': () => import('../pages/OrdersPage.tsx'),
  '/pedidos/:id': () => import('../pages/OrderPage.tsx'),
  '/perfil': () => import('../pages/ProfilePage.tsx'),
  '/notificacoes': () => import('../pages/NotificationsPage.tsx'),
} as const

const patterns = Object.keys(pageLoaders) as (keyof typeof pageLoaders)[]

/** Pré-carrega o chunk da rota (hover/foco). Falhas são ignoradas: o carregamento real tentará de novo. */
export function prefetchRoute(path: string): void {
  const clean = path.split(/[?#]/)[0] ?? path
  const pattern = patterns.find((p) => matchPath({ path: p, end: true }, clean))
    ?? (clean.startsWith('/perfil') ? '/perfil' : undefined)
  if (!pattern) return
  void pageLoaders[pattern]().catch(() => undefined)
}
