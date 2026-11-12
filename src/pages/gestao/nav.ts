import {
  BarChart3, Briefcase, ChefHat, Clock, ClipboardList, LayoutDashboard, LayoutGrid, PackageCheck, PiggyBank, Receipt, ReceiptText,
  Settings, Star, Store, Users, UtensilsCrossed, Wallet, CalendarClock, FileBarChart, Megaphone,
} from 'lucide-react'
import type { BusinessPermission } from '../../features/permissions/permissions.ts'

/** Nicho operacional: decide quais módulos aparecem (Mesas/Comandas não são para todos). */
export type Niche = 'restaurante' | 'mercadinho' | 'loja' | 'servico'

const MERCADO = /mercad|mercearia|supermerc|hortifr|a[çc]ougue|padaria|conveni|empório|emporio|distribuidora|bebida/i

export function nicheOf(businessType: 'restaurante' | 'loja' | 'servico', categoryName?: string | null): Niche {
  if (businessType === 'restaurante') return 'restaurante'
  if (businessType === 'servico') return 'servico'
  return categoryName && MERCADO.test(categoryName) ? 'mercadinho' : 'loja'
}

export const NICHE_LABEL: Record<Niche, string> = { restaurante: 'Restaurante', mercadinho: 'Mercadinho', loja: 'Loja', servico: 'Serviços' }

export interface GestaoNavItem {
  to: string
  label: string
  icon: typeof Store
  permission: BusinessPermission
  /** Módulo do plano Premium (mostrado com selo; o banco bloqueia sem o plano). */
  premium?: boolean
  niches?: readonly Niche[]
}

const menuLabel: Record<Niche, string> = { restaurante: 'Cardápio', mercadinho: 'Produtos', loja: 'Catálogo', servico: 'Serviços' }

/** Menu superior do Tucaí Gestão, filtrado por nicho, cargo e plano. */
export function gestaoNav(niche: Niche): GestaoNavItem[] {
  const items: GestaoNavItem[] = [
    { to: '', label: 'Visão geral', icon: LayoutDashboard, permission: 'orders.view' },
    { to: 'loja', label: 'Minha loja', icon: Store, permission: 'store.customize' },
    { to: 'horarios', label: niche === 'servico' ? 'Agenda e horários' : 'Horários', icon: niche === 'servico' ? CalendarClock : Clock, permission: 'store.customize' },
    { to: 'cardapio', label: menuLabel[niche], icon: LayoutGrid, permission: 'menu.manage' },
    { to: 'pedidos', label: 'Pedidos recebidos', icon: ReceiptText, permission: 'orders.view' },
    { to: 'cozinha', label: 'Cozinha', icon: ChefHat, permission: 'orders.view', niches: ['restaurante'] },
    { to: 'cozinha', label: 'Separação', icon: PackageCheck, permission: 'orders.view', niches: ['mercadinho'] },
    { to: 'mesas', label: 'Comandas e mesas', icon: UtensilsCrossed, permission: 'tabs.manage', premium: true, niches: ['restaurante'] },
    { to: 'mesas', label: 'Comandas de balcão', icon: ClipboardList, permission: 'tabs.manage', premium: true, niches: ['mercadinho'] },
    { to: 'caixa', label: 'Caixa', icon: Wallet, permission: 'cash.manage', premium: true, niches: ['restaurante', 'mercadinho', 'loja'] },
    { to: 'vendas', label: 'Vendas', icon: BarChart3, permission: 'reports.view' },
    { to: 'gastos', label: 'Controle de gastos', icon: Receipt, permission: 'reports.view', premium: true },
    { to: 'lucro', label: 'Meu lucro', icon: PiggyBank, permission: 'reports.view', premium: true },
    { to: 'anuncios', label: 'Anúncios', icon: Megaphone, permission: 'store.customize' },
    { to: 'equipe', label: 'Equipe', icon: Users, permission: 'staff.manage' },
    { to: 'relatorios', label: 'Relatórios', icon: FileBarChart, permission: 'reports.view' },
    { to: 'avaliacoes', label: 'Avaliações', icon: Star, permission: 'store.customize' },
    { to: 'vagas', label: 'Vagas', icon: Briefcase, permission: 'jobs.manage' },
    { to: 'configuracoes', label: 'Configurações', icon: Settings, permission: 'reports.view' },
  ]
  return items.filter((i) => !i.niches || i.niches.includes(niche))
}
