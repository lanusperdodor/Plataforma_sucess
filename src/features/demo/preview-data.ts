/**
 * PRÉVIA VISUAL — conteúdo LOCAL de demonstração para áreas ainda sem backend
 * (Comunidade, Vagas, Pedidos, Notificações). Tudo é fictício e marcado `isDemo`; a UI rotula.
 * Nada aqui é gravado, enviado ou cobrado.
 */

export type PostType =
  | 'imagem_texto'
  | 'promocao'
  | 'oferta_relampago'
  | 'vaga'
  | 'evento'
  | 'video'
  | 'atualizacao_comercial'
  | 'novo_produto'

export const POST_TYPE_LABEL: Record<PostType, string> = {
  imagem_texto: 'Publicação',
  promocao: 'Promoção',
  oferta_relampago: 'Oferta relâmpago',
  vaga: 'Vaga',
  evento: 'Evento',
  video: 'Vídeo',
  atualizacao_comercial: 'Aviso',
  novo_produto: 'Novidade',
}

export interface DemoPost {
  id: string
  type: PostType
  businessName: string
  businessSlug: string
  businessKind: 'restaurante' | 'loja' | 'servico'
  minutesAgo: number
  text: string
  location?: string
  /** Publicação turbinada (impulsionamento pago pela empresa). Sempre rotulada como patrocinada. */
  sponsored?: boolean
  likes: number
  comments: number
  /** Texto do destaque (preço, data do evento, cargo) */
  highlight?: string
  isDemo: true
}

export const DEMO_POSTS: DemoPost[] = [
  { id: 'p1', type: 'promocao', businessName: 'Pizzaria Modelo (demo)', businessSlug: 'pizzaria-demo', businessKind: 'restaurante', minutesAgo: 12, text: 'Terça da pizza: a segunda média sai pela metade do preço. Válido no salão e na retirada.', highlight: 'Exemplo de campanha', sponsored: true, likes: 34, comments: 6, isDemo: true },
  { id: 'p2', type: 'novo_produto', businessName: 'Açaí Fictício (demo)', businessSlug: 'acai-demo', businessKind: 'restaurante', minutesAgo: 45, text: 'Chegou o açaí com cupuaçu e granola artesanal. Venha provar!', likes: 21, comments: 3, isDemo: true },
  { id: 'p3', type: 'vaga', businessName: 'Lanchonete Exemplo (demo)', businessSlug: 'lanchonete-demo', businessKind: 'restaurante', minutesAgo: 90, text: 'Procuramos atendente para o turno da noite. Experiência com caixa é um diferencial.', highlight: 'Atendente · Noite', likes: 12, comments: 9, isDemo: true },
  { id: 'p4', type: 'evento', businessName: 'Moda Modelo (demo)', businessSlug: 'roupas-demo', businessKind: 'loja', minutesAgo: 180, text: 'Desfile da coleção de verão na praça, com música ao vivo e sorteio para quem passar por lá.', highlight: 'Sábado · 17h', location: 'Praça central (demo)', likes: 58, comments: 14, isDemo: true },
  { id: 'p5', type: 'oferta_relampago', businessName: 'Hamburgueria Amostra (demo)', businessSlug: 'hamburgueria-demo', businessKind: 'restaurante', minutesAgo: 240, text: 'Só hoje até as 21h: batata grande de cortesia nos pedidos de burger duplo.', highlight: 'Termina hoje', sponsored: true, likes: 40, comments: 5, isDemo: true },
  { id: 'p6', type: 'atualizacao_comercial', businessName: 'Farmácia Exemplo (demo)', businessSlug: 'farmacia-demo', businessKind: 'loja', minutesAgo: 600, text: 'A partir de segunda, atendimento estendido até as 22h todos os dias.', likes: 9, comments: 1, isDemo: true },
  { id: 'p7', type: 'video', businessName: 'Salão Exemplo (demo)', businessSlug: 'beleza-demo', businessKind: 'servico', minutesAgo: 1440, text: 'Bastidores: como fazemos uma escova que dura a semana inteira.', likes: 27, comments: 4, isDemo: true },
  { id: 'p8', type: 'imagem_texto', businessName: 'Marmitaria Teste (demo)', businessSlug: 'marmitaria-demo', businessKind: 'restaurante', minutesAgo: 2880, text: 'O cardápio da semana já está no ar: feijoada na quarta e peixe na sexta.', likes: 16, comments: 2, isDemo: true },
]

export interface DemoJob {
  id: string
  title: string
  businessName: string
  category: 'Alimentação' | 'Comércio' | 'Beleza' | 'Entregas' | 'Serviços'
  type: 'CLT' | 'Temporário' | 'Freelance' | 'Meio período'
  city: string
  salary?: string
  daysAgo: number
  description: string
  isDemo: true
}

export const DEMO_JOBS: DemoJob[] = [
  { id: 'j1', title: 'Atendente', businessName: 'Lanchonete Exemplo (demo)', category: 'Alimentação', type: 'CLT', city: 'Itaú de Minas, MG', salary: 'A combinar', daysAgo: 0, description: 'Atendimento no balcão e no caixa, turno da noite.', isDemo: true },
  { id: 'j2', title: 'Entregador(a) parceiro(a)', businessName: 'Tucaí Entregas (demo)', category: 'Entregas', type: 'Freelance', city: 'Itaú de Minas, MG', daysAgo: 1, description: 'Moto própria e CNH A. Você escolhe os horários.', isDemo: true },
  { id: 'j3', title: 'Auxiliar de cozinha', businessName: 'Marmitaria Teste (demo)', category: 'Alimentação', type: 'Meio período', city: 'Itaú de Minas, MG', daysAgo: 2, description: 'Preparo e organização da cozinha no almoço.', isDemo: true },
  { id: 'j4', title: 'Cabeleireira', businessName: 'Salão Exemplo (demo)', category: 'Beleza', type: 'CLT', city: 'Itaú de Minas, MG', daysAgo: 3, description: 'Corte, escova e coloração. Comissão sobre atendimentos.', isDemo: true },
  { id: 'j5', title: 'Vendedor(a)', businessName: 'Moda Modelo (demo)', category: 'Comércio', type: 'Temporário', city: 'Itaú de Minas, MG', daysAgo: 4, description: 'Reforço para a temporada de fim de ano.', isDemo: true },
  { id: 'j6', title: 'Balconista', businessName: 'Farmácia Exemplo (demo)', category: 'Comércio', type: 'CLT', city: 'Itaú de Minas, MG', daysAgo: 6, description: 'Atendimento ao cliente e reposição.', isDemo: true },
]

export type OrderStage = 'recebido' | 'preparando' | 'a_caminho' | 'entregue' | 'cancelado'
export const ORDER_STAGES: { id: OrderStage; label: string }[] = [
  { id: 'recebido', label: 'Recebido' },
  { id: 'preparando', label: 'Preparando' },
  { id: 'a_caminho', label: 'A caminho' },
  { id: 'entregue', label: 'Entregue' },
]

export interface DemoOrder {
  id: string
  code: string
  businessName: string
  items: string
  totalCents: number
  stage: OrderStage
  whenLabel: string
  isDemo: true
}

/** Exemplos de como os pedidos aparecem. NÃO são pedidos do usuário. */
export const DEMO_ORDERS: DemoOrder[] = [
  { id: 'o1', code: 'EX-1042', businessName: 'Pizzaria Modelo (demo)', items: '1× Pizza Mussarela, 1× Refrigerante 2L', totalCents: 5600, stage: 'a_caminho', whenLabel: 'Hoje, 19:42', isDemo: true },
  { id: 'o2', code: 'EX-0981', businessName: 'Açaí Fictício (demo)', items: '2× Açaí no Copo', totalCents: 3400, stage: 'entregue', whenLabel: 'Ontem, 15:10', isDemo: true },
  { id: 'o3', code: 'EX-0870', businessName: 'Lanchonete Exemplo (demo)', items: '1× X-Salada, 1× Suco Natural', totalCents: 3100, stage: 'entregue', whenLabel: '02/11, 12:30', isDemo: true },
]

export interface DemoNotification {
  id: string
  title: string
  text: string
  whenLabel: string
  unread: boolean
  to: string
  isDemo: true
}

export const DEMO_NOTIFICATIONS: DemoNotification[] = [
  { id: 'n1', title: 'Seu pedido saiu para entrega', text: 'Exemplo: Pizzaria Modelo (demo) · pedido EX-1042', whenLabel: 'há 5 min', unread: true, to: '/pedidos', isDemo: true },
  { id: 'n2', title: 'Nova publicação de quem você segue', text: 'Exemplo: Açaí Fictício (demo) publicou uma novidade', whenLabel: 'há 1 h', unread: true, to: '/comunidade', isDemo: true },
  { id: 'n3', title: 'Vaga perto de você', text: 'Exemplo: Atendente na Lanchonete Exemplo (demo)', whenLabel: 'ontem', unread: false, to: '/vagas', isDemo: true },
]

export function relativeTime(minutes: number): string {
  if (minutes < 60) return `há ${minutes} min`
  const h = Math.round(minutes / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ontem' : `há ${d} dias`
}