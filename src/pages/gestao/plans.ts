/** Planos da Tucaí (preço de referência para a tela; o valor cobrado vem SEMPRE da tabela de planos no banco). */
export const PLANS = [
  {
    code: 'delivery' as const,
    name: 'Padrão',
    price: 'R$ 79,90/mês',
    items: ['Loja e cardápio na Tucaí', 'Pedidos de delivery e retirada', 'Cozinha/separação dos pedidos', 'Vendas e visão geral', 'Equipe com cargos'],
  },
  {
    code: 'presencial_delivery' as const,
    name: 'Premium',
    price: 'R$ 99,90/mês',
    items: ['Tudo do Padrão', 'Comandas e mesas', 'Caixa presencial com fechamento', 'QR das mesas', 'Controle de gastos e Meu Lucro', 'Calculadora de custos e preço sugerido', 'Relatórios avançados'],
  },
]
export type PlanCode = (typeof PLANS)[number]['code']
