import { RECENT_KEY } from '../recent/recentStore'
import { CITY_KEY } from '../location/cityStore'

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
    key: 'scroll:<página>',
    where: 'sessionStorage',
    category: 'necessario',
    purpose: 'Voltar à mesma posição da página ao navegar.',
    lifetime: 'Até fechar a aba.',
    clearable: true,
  },
]

/** Hoje não há cookies, estatísticas nem marketing: nenhum banner de consentimento é necessário. */
export const USES_NON_ESSENTIAL_TRACKING = STORAGE_ITEMS.some((i) => i.category === 'estatisticas' || i.category === 'marketing')

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
  { name: 'Monitoramento de erros', role: '—', status: 'Nenhum em uso.' },
]
