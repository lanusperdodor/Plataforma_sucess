import {
  BarChart3, Briefcase, Calculator, ChefHat, Clock, ClipboardList, LayoutDashboard, LayoutGrid, PackageCheck, PiggyBank, Receipt, ReceiptText,
  Star, Store, Truck, Users, UtensilsCrossed, Wallet, CalendarClock, FileBarChart, Megaphone,
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

/** Seis menus, com nomes simples. Visual neutro: o único destaque de cor é o laranja do item ativo. */
export type NavGroupId = 'inicio' | 'pedidos' | 'produtos' | 'entregas' | 'financeiro' | 'configuracoes'
const G = { text: 'text-ink-muted', chip: 'bg-muted text-ink', active: 'bg-muted', bar: 'bg-orange' }
export const NAV_GROUPS: Record<NavGroupId, { label: string; text: string; chip: string; active: string; bar: string }> = {
  inicio: { label: 'Início', ...G },
  pedidos: { label: 'Pedidos', ...G },
  produtos: { label: 'Produtos', ...G },
  entregas: { label: 'Entregas', ...G },
  financeiro: { label: 'Financeiro', ...G },
  configuracoes: { label: 'Configurações', ...G },
}

export interface GestaoNavItem {
  to: string
  label: string
  /** Frase curta que explica para que serve (aparece na visão geral e como dica). */
  hint: string
  icon: typeof Store
  permission: BusinessPermission
  group: NavGroupId
  /** Módulo do plano Premium (mostrado com selo; o banco bloqueia sem o plano). */
  premium?: boolean
  niches?: readonly Niche[]
}

const menuLabel: Record<Niche, string> = { restaurante: 'Cardápio', mercadinho: 'Produtos', loja: 'Catálogo', servico: 'Serviços' }

/** Menu do Tucaí Gestão, filtrado por nicho, cargo e plano, na ordem dos grupos. */
export function gestaoNav(niche: Niche): GestaoNavItem[] {
  const items: GestaoNavItem[] = [
    { to: '', label: 'Início', hint: 'Vendas, pedidos e o que você paga', icon: LayoutDashboard, permission: 'orders.view', group: 'inicio' },

    { to: 'pedidos', label: 'Pedidos recebidos', hint: 'Aceitar e acompanhar pedidos', icon: ReceiptText, permission: 'orders.view', group: 'pedidos' },
    { to: 'cozinha', label: 'Cozinha', hint: 'Fila de preparo', icon: ChefHat, permission: 'orders.view', group: 'pedidos', niches: ['restaurante'] },
    { to: 'cozinha', label: 'Separação', hint: 'Fila de separação', icon: PackageCheck, permission: 'orders.view', group: 'pedidos', niches: ['mercadinho'] },
    { to: 'mesas', label: 'Comandas e mesas', hint: 'Atendimento no salão', icon: UtensilsCrossed, permission: 'tabs.manage', group: 'pedidos', premium: true, niches: ['restaurante'] },
    { to: 'mesas', label: 'Comandas de balcão', hint: 'Atendimento no balcão', icon: ClipboardList, permission: 'tabs.manage', group: 'pedidos', premium: true, niches: ['mercadinho'] },
    { to: 'caixa', label: 'Caixa', hint: 'Abrir, movimentar e fechar o caixa', icon: Wallet, permission: 'cash.manage', group: 'pedidos', premium: true, niches: ['restaurante', 'mercadinho', 'loja'] },

    { to: 'cardapio', label: menuLabel[niche], hint: 'Produtos e preços', icon: LayoutGrid, permission: 'menu.manage', group: 'produtos' },
    { to: 'calculadora', label: 'Calculadora de custos', hint: 'Seu preço está bom?', icon: Calculator, permission: 'reports.view', group: 'produtos', premium: true },
    { to: 'avaliacoes', label: 'Avaliações', hint: 'O que os clientes dizem', icon: Star, permission: 'store.customize', group: 'produtos' },
    { to: 'anuncios', label: 'Anúncios', hint: 'Divulgar suas publicações', icon: Megaphone, permission: 'store.customize', group: 'produtos' },

    { to: 'entregas', label: 'Entregas', hint: 'Entregas em andamento e feitas', icon: Truck, permission: 'orders.view', group: 'entregas', niches: ['restaurante', 'mercadinho', 'loja'] },

    { to: 'vendas', label: 'Vendas', hint: 'O que foi vendido', icon: BarChart3, permission: 'reports.view', group: 'financeiro' },
    { to: 'configuracoes', label: 'Mensalidade e cobranças', hint: 'Seu plano e o que você paga à Tucaí', icon: Receipt, permission: 'reports.view', group: 'financeiro' },
    { to: 'gastos', label: 'Controle de gastos', hint: 'Lançar despesas', icon: Receipt, permission: 'reports.view', group: 'financeiro', premium: true },
    { to: 'lucro', label: 'Meu lucro', hint: 'Quanto sobra no fim do mês', icon: PiggyBank, permission: 'reports.view', group: 'financeiro', premium: true },
    { to: 'relatorios', label: 'Relatórios', hint: 'Recebimentos e gastos por período', icon: FileBarChart, permission: 'reports.view', group: 'financeiro' },

    { to: 'loja', label: 'Minha loja', hint: 'Dados, fotos e entrega', icon: Store, permission: 'store.customize', group: 'configuracoes' },
    { to: 'horarios', label: niche === 'servico' ? 'Agenda e horários' : 'Horários', hint: 'Quando você atende', icon: niche === 'servico' ? CalendarClock : Clock, permission: 'store.customize', group: 'configuracoes' },
    { to: 'equipe', label: 'Equipe', hint: 'Funcionários e permissões', icon: Users, permission: 'staff.manage', group: 'configuracoes' },
    { to: 'vagas', label: 'Vagas', hint: 'Contratar pessoas', icon: Briefcase, permission: 'jobs.manage', group: 'configuracoes' },
  ]
  return items.filter((i) => !i.niches || i.niches.includes(niche))
}
