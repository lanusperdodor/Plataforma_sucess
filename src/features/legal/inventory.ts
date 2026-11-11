import { RECENT_KEY } from '../recent/recentStore'
import { CITY_KEY } from '../location/cityStore'
import { CART_KEY } from '../cart/cartStore'
import { CONSENT_KEY } from '../tracking/consentStore'
import { TRACKED_PURCHASES_KEY } from '../tracking/tracker'

/**
 * Inventário do que a Tucaí efetivamente trata HOJE (fonte única para a política de
 * privacidade, a página de armazenamento local e os testes). Atualize ao criar novo tratamento.
 */

export type StorageCategory = 'necessario' | 'preferencias' | 'estatisticas' | 'marketing'

export interface StorageItem {
  key: string
  where: 'localStorage' | 'sessionStorage' | 'cookie'
  category: StorageCategory
  purpose: string
  lifetime: string
  /** Pode ser apagado pela página de armazenamento sem quebrar a conta. */
  clearable: boolean
}

export const STORAGE_ITEMS: readonly StorageItem[] = [
  {
    key: 'sb-<projeto>-auth-token',
    where: 'localStorage',
    category: 'necessario',
    purpose: 'Manter você conectado (sessão do Supabase Auth). Criado só depois do login.',
    lifetime: 'Até sair da conta ou a sessão expirar.',
    clearable: false,
  },
  {
    key: CITY_KEY,
    where: 'localStorage',
    category: 'preferencias',
    purpose: 'Lembrar a cidade escolhida.',
    lifetime: 'Até você trocar de cidade ou apagar.',
    clearable: true,
  },
  {
    key: RECENT_KEY,
    where: 'localStorage',
    category: 'preferencias',
    purpose: 'Mostrar “Últimos vistos” neste aparelho (não é enviado ao servidor).',
    lifetime: 'Até 12 itens; até você apagar.',
    clearable: true,
  },
  {
    key: CART_KEY,
    where: 'localStorage',
    category: 'necessario',
    purpose: 'Guardar os itens da sacola até você confirmar o pedido (não é enviado ao servidor antes disso).',
    lifetime: 'Até concluir o pedido, esvaziar a sacola ou apagar.',
    clearable: true,
  },
  {
    key: CONSENT_KEY,
    where: 'localStorage',
    category: 'necessario',
    purpose: 'Guardar sua escolha sobre cookies de estatística e marketing (com data e versão do aviso).',
    lifetime: 'Até você mudar a escolha, o aviso mudar ou apagar.',
    clearable: true,
  },
  {
    key: TRACKED_PURCHASES_KEY,
    where: 'localStorage',
    category: 'estatisticas',
    purpose: 'Evitar contar a mesma compra duas vezes nas estatísticas (só identificadores de pedidos). Criado só com estatísticas ou marketing aceitos.',
    lifetime: 'Últimos 100 pedidos; até você apagar.',
    clearable: true,
  },
  {
    key: 'scroll:<página>',
    where: 'sessionStorage',
    category: 'necessario',
    purpose: 'Voltar à mesma posição da página ao navegar.',
    lifetime: 'Até fechar a aba.',
    clearable: true,
  },
]

/**
 * Ferramentas de terceiros que só funcionam quando o ID está configurado no Worker E a pessoa aceita.
 * Sem ID configurado nada é carregado e o aviso de cookies não aparece.
 */
export const TRACKING_TOOLS: readonly { tool: 'ga4' | 'pixel'; name: string; category: StorageCategory; cookies: string; purpose: string; lifetime: string }[] = [
  {
    tool: 'ga4',
    name: 'Google Analytics 4',
    category: 'estatisticas',
    cookies: '_ga, _ga_<ID>',
    purpose: 'Medir visitas e uso do site de forma agregada (páginas vistas, buscas, etapas do pedido), sem nome, e-mail, telefone ou endereço.',
    lifetime: 'Até 2 anos (definido pelo Google).',
  },
  {
    tool: 'pixel',
    name: 'Meta Pixel (Facebook e Instagram)',
    category: 'marketing',
    cookies: '_fbp',
    purpose: 'Medir resultados de anúncios da Tucaí no Facebook e Instagram (visualizações, sacola, início do pedido e pedido concluído), sem dados de contato.',
    lifetime: 'Até 90 dias (definido pela Meta).',
  },
]

/** Há rastreamento não essencial configurado? (Se sim, o aviso de cookies aparece.) */
export const usesNonEssentialTracking = (config: { ga4: string | null; pixel: string | null }) => Boolean(config.ga4 || config.pixel)

export interface ProcessingActivity {
  data: string
  purpose: string
  legalBasis: string
  systems: string
  retention: string
  access: string
}

/** Tratamentos de dados pessoais existentes. Bases legais sujeitas à validação jurídica. */
export const PROCESSING: readonly ProcessingActivity[] = [
  {
    data: 'E-mail, senha (somente hash, pelo Supabase Auth), nome e telefone opcionais',
    purpose: 'Criar e manter sua conta e autenticar o acesso',
    legalBasis: 'Execução de contrato (LGPD, art. 7º, V)',
    systems: 'Supabase (Auth e banco de dados)',
    retention: 'Enquanto a conta existir; após exclusão, anonimização do perfil',
    access: 'Você; equipe com permissão “Consultar usuários”',
  },
  {
    data: 'Cidade preferida',
    purpose: 'Mostrar estabelecimentos da sua região',
    legalBasis: 'Execução de contrato (art. 7º, V)',
    systems: 'Supabase; seu navegador (localStorage)',
    retention: 'Enquanto a conta existir ou até você trocar',
    access: 'Você',
  },
  {
    data: 'Dados do negócio enviados na solicitação (nome, telefone, endereço, descrição)',
    purpose: 'Analisar e publicar o estabelecimento',
    legalBasis: 'Procedimentos preliminares a contrato (art. 7º, V)',
    systems: 'Supabase',
    retention: 'Enquanto o cadastro existir; recusas por até 5 anos para defesa de direitos (a validar)',
    access: 'Você e membros do negócio; equipe com permissão “Analisar estabelecimentos”',
  },
  {
    data: 'Registros de auditoria (quem fez qual ação administrativa ou cadastral e quando)',
    purpose: 'Segurança, prevenção a fraudes e prestação de contas',
    legalBasis: 'Legítimo interesse (art. 7º, IX) e obrigação legal (art. 7º, II)',
    systems: 'Supabase',
    retention: 'Mínimo de 6 meses (Marco Civil da Internet, art. 15); prazo final a validar',
    access: 'Equipe com permissão “Ver auditoria”',
  },
  {
    data: 'Solicitações de privacidade e seus resultados',
    purpose: 'Atender os direitos do titular e comprovar o atendimento',
    legalBasis: 'Obrigação legal (art. 7º, II)',
    systems: 'Supabase',
    retention: '5 anos após o encerramento (a validar)',
    access: 'Você; equipe com permissão “Atender solicitações de privacidade”',
  },
  {
    data: 'Conectuaí: perfil social (nome de exibição, @usuário, bio, foto e cidade opcionais), publicações, comentários, curtidas, salvos, seguidas e bloqueios',
    purpose: 'Rede social regional escolhida por você',
    legalBasis: 'Execução de contrato (art. 7º, V); o conteúdo público é publicado por sua decisão',
    systems: 'Supabase',
    retention: 'Até você apagar ou excluir a conta (exclusão remove o perfil social e o conteúdo)',
    access: 'Público conforme sua privacidade (perfil fechado: só seguidores aprovados); salvos e bloqueios só você',
  },
  {
    data: 'Denúncias, decisões de moderação e contestações',
    purpose: 'Segurança da comunidade, revisão humana e direito de contestação',
    legalBasis: 'Legítimo interesse (art. 7º, IX)',
    systems: 'Supabase',
    retention: 'Enquanto necessárias para defesa de direitos (prazo a validar)',
    access: 'Quem denunciou ou foi moderado; equipe com permissão “Moderação do Conectuaí”',
  },
  {
    data: 'Pedidos: nome, telefone, endereço de entrega, itens, forma de pagamento e observações',
    purpose: 'Preparar, entregar e cobrar o pedido; histórico e avaliação verificada',
    legalBasis: 'Execução de contrato (art. 7º, V); obrigação legal fiscal (art. 7º, II)',
    systems: 'Supabase',
    retention: 'Enquanto a conta existir; após exclusão, o pedido fica sem dados pessoais para a contabilidade',
    access: 'Você; equipe do estabelecimento com permissão de pedidos; entregador parceiro só após aceitar a entrega',
  },
  {
    data: 'Entregadores parceiros: nome, telefone, cidade, veículo, placa, CNH e entregas realizadas',
    purpose: 'Análise do cadastro, distribuição de entregas e repasse de ganhos',
    legalBasis: 'Execução de contrato (art. 7º, V)',
    systems: 'Supabase',
    retention: 'Enquanto a parceria existir; histórico de entregas sem o cadastro após exclusão',
    access: 'Você; equipe com permissão “Analisar entregadores”; cliente vê só o primeiro nome e o veículo',
  },
  {
    data: 'Candidaturas a vagas: nome, telefone, mensagem e experiência informadas',
    purpose: 'Processo seletivo da vaga escolhida por você',
    legalBasis: 'Procedimentos preliminares a contrato (art. 7º, V)',
    systems: 'Supabase',
    retention: 'Até você excluir a conta; a vaga encerrada não apaga a candidatura automaticamente (prazo a validar)',
    access: 'Você; dono e gerente do estabelecimento que publicou a vaga',
  },
  {
    data: 'Estatísticas de navegação (Google Analytics 4) e medição de anúncios (Meta Pixel): páginas vistas, buscas, itens vistos, sacola e pedidos concluídos, com identificadores técnicos do navegador',
    purpose: 'Entender o uso do site e medir campanhas',
    legalBasis: 'Consentimento (art. 7º, I), revogável a qualquer momento nas preferências de cookies',
    systems: 'Google e Meta, como operadores/controladores conforme seus termos (a confirmar)',
    retention: 'Conforme os prazos configurados nas ferramentas (a definir) e os cookies listados na página de armazenamento',
    access: 'Equipe autorizada da Tucaí nos painéis das ferramentas',
  },
  {
    data: 'Endereço IP, navegador e horários de requisição (registros técnicos)',
    purpose: 'Funcionamento, segurança e limite de abuso',
    legalBasis: 'Legítimo interesse (art. 7º, IX) e obrigação legal (art. 7º, II)',
    systems: 'Cloudflare (hospedagem) e Supabase (API), como operadores',
    retention: 'Conforme os prazos dos operadores (a confirmar no contrato)',
    access: 'Equipe técnica autorizada',
  },
]

/** Fornecedores que tratam dados (operadores). Contratos: situação real, sem presumir assinatura. */
export const OPERATORS: readonly { name: string; role: string; status: string }[] = [
  { name: 'Supabase', role: 'Banco de dados, autenticação e e-mails de conta', status: 'Em uso. Região do projeto e DPA a confirmar.' },
  { name: 'Cloudflare', role: 'Hospedagem do site e CDN', status: 'Em uso. Termos/DPA a confirmar.' },
  { name: 'GitHub', role: 'Código-fonte (sem dados de usuários)', status: 'Em uso. Não trata dados de clientes.' },
  { name: 'Provedor de pagamentos', role: 'Pix e cartão', status: 'Não contratado.' },
  { name: 'Mapas e rotas', role: 'Distância e tempo de entrega', status: 'Não contratado.' },
  { name: 'Mensageria / notificações', role: 'Avisos de pedidos', status: 'Não contratado.' },
  { name: 'Ferramentas de IA', role: '—', status: 'Nenhuma em uso no produto.' },
  { name: 'Google (Analytics 4)', role: 'Estatísticas de uso do site', status: 'Preparado. Só funciona se o ID for configurado e você aceitar.' },
  { name: 'Meta (Pixel)', role: 'Medição de anúncios no Facebook e Instagram', status: 'Preparado. Só funciona se o ID for configurado e você aceitar.' },
  { name: 'Monitoramento de erros', role: '—', status: 'Nenhum em uso.' },
]
