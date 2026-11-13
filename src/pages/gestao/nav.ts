import {
  BarChart3, Briefcase, Calculator, ChefHat, Clock, ClipboardList, LayoutDashboard, LayoutGrid, PackageCheck, PiggyBank, Receipt, ReceiptText,
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

/** Grupos do menu lateral, cada um com uma cor (classes completas para o Tailwind encontrar). */
export type NavGroupId = 'inicio' | 'operacao' | 'financas' | 'loja' | 'crescer' | 'gestao'
export const NAV_GROUPS: Record<NavGroupId, { label: string; text: string; chip: string; active: string; bar: string }> = {
  inicio: { label: 'Início', text: 'text-tone-blue', chip: 'bg-tone-blue/15 text-tone-blue', active: 'bg-tone-blue/10', bar: 'bg-tone-blue' },
  operacao: { label: 'Operação', text: 'text-tone-orange', chip: 'bg-tone-orange/15 text-tone-orange', active: 'bg-tone-orange/10', bar: 'bg-tone-orange' },
  financas: { label: 'Finanças', text: 'text-tone-green', chip: 'bg-tone-green/15 text-tone-green', active: 'bg-tone-green/10', bar: 'bg-tone-green' },
  loja: { label: 'Minha loja', text: 'text-tone-violet', chip: 'bg-tone-violet/15 text-tone-violet', active: 'bg-tone-violet/10', bar: 'bg-tone-violet' },
  crescer: { label: 'Crescer', text: 'text-tone-teal', chip: 'bg-tone-teal/15 text-tone-teal', active: 'bg-tone-teal/10', bar: 'bg-tone-teal' },
  gestao: { label: 'Gestão', text: 'text-tone-amber', chip: 'bg-tone-amber/15 text-tone-amber', active: 'bg-tone-amber/10', bar: 'bg-tone-amber' },
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
    { to: '', label: 'Visão geral', hint: 'Resumo do dia e próximos passos', icon: LayoutDashboard, permission: 'orders.view', group: 'inicio' },

    { to: 'pedidos', label: 'Pedidos recebidos', hint: 'Aceitar e acompanhar pedidos', icon: ReceiptText, permission: 'orders.view', group: 'operacao' },
    { to: 'cozinha', label: 'Cozinha', hint: 'Fila de preparo', icon: ChefHat, permission: 'orders.view', group: 'operacao', niches: ['restaurante'] },
    { to: 'cozinha', label: 'Separação', hint: 'Fila de separação', icon: PackageCheck, permission: 'orders.view', group: 'operacao', niches: ['mercadinho'] },
    { to: 'mesas', label: 'Comandas e mesas', hint: 'Atendimento no salão', icon: UtensilsCrossed, permission: 'tabs.manage', group: 'operacao', premium: true, niches: ['restaurante'] },
    { to: 'mesas', label: 'Comandas de balcão', hint: 'Atendimento no balcão', icon: ClipboardList, permission: 'tabs.manage', group: 'operacao', premium: true, niches: ['mercadinho'] },
    { to: 'caixa', label: 'Caixa', hint: 'Abrir, movimentar e fechar o caixa', icon: Wallet, permission: 'cash.manage', group: 'operacao', premium: true, niches: ['restaurante', 'mercadinho', 'loja'] },

    { to: 'vendas', label: 'Vendas', hint: 'O que foi vendido', icon: BarChart3, permission: 'reports.view', group: 'financas' },
    { to: 'gastos', label: 'Controle de gastos', hint: 'Lançar despesas', icon: Receipt, permission: 'reports.view', group: 'financas', premium: true },
    { to: 'lucro', label: 'Meu lucro', hint: 'Quanto sobra no fim do mês', icon: PiggyBank, permission: 'reports.view', group: 'financas', premium: true },
    { to: 'calculadora', label: 'Calculadora de custos', hint: 'Seu preço está bom?', icon: Calculator, permission: 'reports.view', group: 'financas', premium: true },
    { to: 'relatorios', label: 'Relatórios', hint: 'Recebimentos e gastos por período', icon: FileBarChart, permission: 'reports.view', group: 'financas' },

    { to: 'loja', label: 'Minha loja', hint: 'Dados, fotos e entrega', icon: Store, permission: 'store.customize', group: 'loja' },
    { to: 'horarios', label: niche === 'servico' ? 'Agenda e horários' : 'Horários', hint: 'Quando você atende', icon: niche === 'servico' ? CalendarClock : Clock, permission: 'store.customize', group: 'loja' },
    { to: 'cardapio', label: menuLabel[niche], hint: 'Produtos e preços', icon: LayoutGrid, permission: 'menu.manage', group: 'loja' },
    { to: 'avaliacoes', label: 'Avaliações', hint: 'O que os clientes dizem', icon: Star, permission: 'store.customize', group: 'loja' },

    { to: 'anuncios', label: 'Anúncios', hint: 'Turbinar publicações', icon: Megaphone, permission: 'store.customize', group: 'crescer' },
    { to: 'vagas', label: 'Vagas', hint: 'Contratar pessoas', icon: Briefcase, permission: 'jobs.manage', group: 'crescer' },

    { to: 'equipe', label: 'Equipe', hint: 'Funcionários e permissões', icon: Users, permission: 'staff.manage', group: 'gestao' },
    { to: 'configuracoes', label: 'Configurações', hint: 'Plano e cobranças', icon: Settings, permission: 'reports.view', group: 'gestao' },
  ]
  return items.filter((i) => !i.niches || i.niches.includes(niche))
}
