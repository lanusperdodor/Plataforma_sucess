import Constants from 'expo-constants'

/** Endereço da Tucaí (troque em app.json → extra.siteUrl quando o domínio oficial estiver no ar). */
export const SITE_URL: string = (Constants.expoConfig?.extra?.siteUrl as string | undefined) ?? 'https://plataforma-sucess.marcossonopi.workers.dev'

const SITE_HOST = new URL(SITE_URL).host

/** Páginas da Tucaí (e do login do Supabase/Google) abrem dentro do app; o resto vai para o navegador/app do celular. */
export function isInternalUrl(url: string): boolean {
  if (url.startsWith('about:') || url.startsWith('blob:') || url.startsWith('data:')) return true
  let u: URL
  try { u = new URL(url) } catch { return false }
  if (u.protocol !== 'https:') return false
  return u.host === SITE_HOST || u.host.endsWith('.supabase.co') || u.host === 'accounts.google.com'
}

/** tucai://pedidos/123 → https://site/pedidos/123 ; link do próprio site é mantido; o resto abre o início. */
export function startUrlFor(link: string): string {
  try {
    if (link.startsWith('tucai://')) return SITE_URL + '/' + link.slice('tucai://'.length).replace(/^\/+/, '')
    const u = new URL(link)
    if (u.host === SITE_HOST) return u.toString()
  } catch { /* link inválido */ }
  return SITE_URL
}
