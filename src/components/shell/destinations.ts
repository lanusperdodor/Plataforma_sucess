import {
  Bell,
  Bike,
  Briefcase,
  Compass,
  House,
  LayoutDashboard,
  MessagesSquare,
  ReceiptText,
  ShieldCheck,
  ShoppingBag,
  Store,
  Truck,
  CircleUser,
  UtensilsCrossed,
  Wrench,
  Lock,
  type LucideIcon,
} from 'lucide-react'
import type { AuthContext } from '../../features/permissions/permissions.ts'
import type { ActiveContext } from '../../lib/activeContext.ts'

export type DestinationId = 'inicio' | 'explorar' | 'conectuai' | 'pedidos' | 'perfil' | 'loja-pedidos' | 'loja-painel' | 'entregas' | 'notificacoes' | 'master'

export type NavDestination = {
  id: DestinationId
  label: string
  to: string
  icon: LucideIcon
  /** Prefixos de rota (por segmento) que ativam o destino. "/" casa só com a raiz. */
  prefixes: readonly string[]
}

/** Quem está navegando (somente UX; cada tela e o banco autorizam de novo). */
export interface Audience {
  signedIn: boolean
  merchant: boolean
  courier: boolean
  admin: boolean
}

export function audienceOf(signedIn: boolean, authz: AuthContext | null | undefined): Audience {
  const roles = authz?.roles ?? []
  return {
    signedIn,
    merchant: (authz?.memberships ?? []).some((m) => m.role !== 'courier_own'),
    courier: roles.includes('courier_partner') || (authz?.memberships ?? []).some((m) => m.role === 'courier_own'),
    admin: roles.includes('platform_master') || roles.includes('platform_operator'),
  }
}

export type SecondaryDestination = {
  id: string
  label: string
  to: string
  icon: LucideIcon
  /** Para quem o item aparece; ausente = todos. */
  show?: (a: Audience) => boolean
}

export interface NavGroup {
  id: string
  title: string
  items: readonly SecondaryDestination[]
}

export const NAV_DESTINATIONS: readonly NavDestination[] = [
  { id: 'inicio', label: 'Início', to: '/', icon: House, prefixes: ['/'] },
  {
    id: 'explorar',
    label: 'Explorar',
    to: '/explorar',
    icon: Compass,
    prefixes: ['/explorar', '/restaurantes', '/lojas', '/servicos', '/vagas', '/busca'],
  },
  { id: 'conectuai', label: 'Conectuaí', to: '/conectuai', icon: MessagesSquare, prefixes: ['/conectuai'] },
  { id: 'pedidos', label: 'Pedidos', to: '/pedidos', icon: ReceiptText, prefixes: ['/pedidos'] },
  {
    id: 'perfil',
    label: 'Perfil',
    to: '/perfil',
    icon: CircleUser,
    prefixes: ['/perfil', '/conta', '/notificacoes'],
  },
]

export const SECONDARY_DESTINATIONS: readonly SecondaryDestination[] = [
  { id: 'restaurantes', label: 'Restaurantes', to: '/restaurantes', icon: UtensilsCrossed },
  { id: 'lojas', label: 'Lojas', to: '/lojas', icon: ShoppingBag },
  { id: 'servicos', label: 'Serviços', to: '/servicos', icon: Wrench },
  { id: 'vagas', label: 'Vagas', to: '/vagas', icon: Briefcase },
]

/** Grupos do menu lateral; cada item aparece só para quem pode usá-lo. */
export const NAV_GROUPS: readonly NavGroup[] = [
  { id: 'descobrir', title: 'Descobrir', items: SECONDARY_DESTINATIONS },
  {
    id: 'conta',
    title: 'Minha conta',
    items: [
      { id: 'notificacoes', label: 'Notificações', to: '/notificacoes', icon: Bell, show: (a) => a.signedIn },
      { id: 'privacidade', label: 'Privacidade e dados', to: '/perfil/privacidade', icon: Lock, show: (a) => a.signedIn },
    ],
  },
  {
    id: 'trabalho',
    title: 'Minha área',
    items: [
      { id: 'painel', label: 'Meu estabelecimento', to: '/painel', icon: LayoutDashboard, show: (a) => a.merchant },
      { id: 'entregador', label: 'Área do entregador', to: '/entregador', icon: Truck, show: (a) => a.courier },
      { id: 'admin', label: 'Painel Master', to: '/admin', icon: ShieldCheck, show: (a) => a.admin },
    ],
  },
  {
    id: 'parceiros',
    title: 'Parceiros',
    items: [
      { id: 'entregadores', label: 'Seja entregador', to: '/entregadores', icon: Bike, show: (a) => !a.courier },
      { id: 'negocio', label: 'Cadastrar negócio', to: '/cadastrar-negocio', icon: Store, show: (a) => !a.merchant },
    ],
  },
]

/** Compatibilidade: itens de parceiros visíveis a qualquer visitante. */
export const PARTNER_DESTINATIONS: readonly SecondaryDestination[] = NAV_GROUPS[3]!.items

export function visibleGroups(a: Audience, ctx: ActiveContext = { kind: 'cliente' }): NavGroup[] {
  // entregador vê só o que é da atividade de entrega; loja e Master não veem "seja parceiro"
  const groups = ctx.kind === 'entregador' ? NAV_GROUPS.filter((g) => g.id === 'conta' || g.id === 'trabalho')
    : ctx.kind === 'cliente' ? NAV_GROUPS : NAV_GROUPS.filter((g) => g.id !== 'parceiros')
  return groups.map((g) => ({ ...g, items: g.items.filter((i) => !i.show || i.show(a)) })).filter((g) => g.items.length > 0)
}

const PERFIL = NAV_DESTINATIONS.find((d) => d.id === 'perfil')!
const INICIO = NAV_DESTINATIONS.find((d) => d.id === 'inicio')!
const CONECTUAI = NAV_DESTINATIONS.find((d) => d.id === 'conectuai')!

/** Navegação principal do perfil ativo (cliente vê a de compras; loja, entregador e Master, a operacional). */
export function destinationsFor(ctx: ActiveContext): readonly NavDestination[] {
  switch (ctx.kind) {
    case 'loja':
      return [
        INICIO,
        { id: 'loja-pedidos', label: 'Pedidos', to: `/painel/${ctx.businessId}/pedidos`, icon: ReceiptText, prefixes: [`/painel/${ctx.businessId}/pedidos`] },
        { id: 'loja-painel', label: 'Minha loja', to: `/painel/${ctx.businessId}`, icon: Store, prefixes: ['/painel'] },
        CONECTUAI,
        PERFIL,
      ]
    case 'entregador':
      return [
        { id: 'entregas', label: 'Entregas', to: '/entregador', icon: Truck, prefixes: ['/entregador'] },
        { id: 'notificacoes', label: 'Avisos', to: '/notificacoes', icon: Bell, prefixes: ['/notificacoes'] },
        PERFIL,
      ]
    case 'master':
      return [INICIO, { id: 'master', label: 'Painel Master', to: '/admin', icon: ShieldCheck, prefixes: ['/admin'] }, PERFIL]
    default:
      return NAV_DESTINATIONS
  }
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  if (prefix === '/') return pathname === '/'
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/** Devolve o id do destino primário ativo (no máximo um) ou null para rotas desconhecidas. */
export function resolveActiveDestination(pathname: string, list: readonly NavDestination[] = NAV_DESTINATIONS): DestinationId | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  for (const destination of list) {
    if (destination.prefixes.some((prefix) => matchesPrefix(path, prefix))) {
      return destination.id
    }
  }
  return null
}

/** Cor de cada destino no menu (classes completas para o Tailwind). Ícone colorido; o texto continua na cor do texto. */
const TONE_BY_ID: Record<string, string> = {
  inicio: 'text-tone-blue', explorar: 'text-tone-violet', conectuai: 'text-tone-rose', pedidos: 'text-tone-orange', perfil: 'text-tone-teal',
  'loja-pedidos': 'text-tone-orange', 'loja-painel': 'text-tone-violet', entregas: 'text-tone-orange', notificacoes: 'text-tone-amber', master: 'text-tone-blue',
  restaurantes: 'text-tone-orange', lojas: 'text-tone-violet', servicos: 'text-tone-teal', vagas: 'text-tone-blue', privacidade: 'text-tone-teal',
  painel: 'text-tone-violet', entregador: 'text-tone-orange', admin: 'text-tone-blue', entregadores: 'text-tone-green', negocio: 'text-tone-rose',
}
export const toneOf = (id: string): string => TONE_BY_ID[id] ?? 'text-tone-blue'
