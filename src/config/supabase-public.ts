/**
 * Projeto Supabase de produção da Tucaí — valores PÚBLICOS por definição:
 * a chave publicável vai para o navegador de qualquer visitante, e a segurança dos dados é
 * garantida pelas regras do banco (RLS e funções). Nunca coloque aqui a chave secreta
 * (service_role / sb_secret_): a varredura `npm run check-secrets` recusa.
 * As variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY, quando definidas, têm prioridade.
 */
export const SUPABASE_PUBLIC = {
  url: 'https://folrcnsihpllvutnhdmy.supabase.co',
  publishableKey: 'sb_publishable_AupTnn-oFiwoodhfXl_06g_ToBuGP9A',
} as const
