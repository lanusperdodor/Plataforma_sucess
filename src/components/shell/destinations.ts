import {
  Bell,
  Briefcase,
  Compass,
  Home,
  Receipt,
  User,
  UtensilsCrossed,
  Users,
  Wrench,
  ShoppingBag,
  Bike,
  Store,
  type LucideIcon,
} from 'lucide-react'

export type DestinationId = 'inicio' | 'explorar' | 'conecta' | 'pedidos' | 'perfil'

export type NavDestination = {
  id: DestinationId
  label: string
  to: string
  icon: LucideIcon
  /** Prefixos de rota (por segmento) que ativam o destino. "/" casa só com a raiz. */
  prefixes: readonly string[]
}

export type SecondaryDestination = {
  id: string
  label: string
  to: string
  icon: LucideIcon
}

export const NAV_DESTINATIONS: readonly NavDestination[] = [
  { id: 'inicio', label: 'Início', to: '/', icon: Home, prefixes: ['/'] },
  {
    id: 'explorar',
    label: 'Explorar',
    to: '/explorar',
    icon: Compass,
    prefixes: ['/explorar', '/restaurantes', '/lojas', '/servicos', '/vagas', '/busca'],
  },
  { id: 'conecta', label: 'Conecta', to: '/conecta', icon: Users, prefixes: ['/conecta'] },
  { id: 'pedidos', label: 'Pedidos', to: '/pedidos', icon: Receipt, prefixes: ['/pedidos'] },
  {
    id: 'perfil',
    label: 'Perfil',
    to: '/perfil',
    icon: User,
    prefixes: ['/perfil', '/conta', '/notificacoes'],
  },
]

export const SECONDARY_DESTINATIONS: readonly SecondaryDestination[] = [
  { id: 'restaurantes', label: 'Restaurantes', to: '/restaurantes', icon: UtensilsCrossed },
  { id: 'lojas', label: 'Lojas', to: '/lojas', icon: ShoppingBag },
  { id: 'servicos', label: 'Serviços', to: '/servicos', icon: Wrench },
  { id: 'vagas', label: 'Vagas', to: '/vagas', icon: Briefcase },
  { id: 'notificacoes', label: 'Notificações', to: '/notificacoes', icon: Bell },
]

/** Áreas de parceiros: entrada clara no desktop (menu lateral) e no mobile (menu do topo/Explorar). */
export const PARTNER_DESTINATIONS: readonly SecondaryDestination[] = [
  { id: 'entregadores', label: 'Entregadores', to: '/entregadores', icon: Bike },
  { id: 'negocio', label: 'Cadastrar negócio', to: '/cadastrar-negocio', icon: Store },
]

function matchesPrefix(pathname: string, prefix: string): boolean {
  if (prefix === '/') return pathname === '/'
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/** Devolve o id do destino primário ativo (no máximo um) ou null para rotas desconhecidas. */
export function resolveActiveDestination(pathname: string): DestinationId | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  for (const destination of NAV_DESTINATIONS) {
    if (destination.prefixes.some((prefix) => matchesPrefix(path, prefix))) {
      return destination.id
    }
  }
  return null
}
