import { RepositoryError, backendUnavailable, mapPostgrestError } from '../../lib/errors'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'

/**
 * Avisos de corrida com o app fechado (Web Push, 0053). O navegador cria a inscrição com a chave PÚBLICA VAPID;
 * guardamos só o endereço da inscrição (sem chaves de criptografia: o push vai sem conteúdo).
 */

type Res = { data: unknown; error: { message: string; code?: string } | null }
async function exec(q: PromiseLike<Res>): Promise<void> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  let res: Res
  try { res = await q } catch (e) { throw mapPostgrestError({ message: e instanceof Error ? e.message : String(e) }) }
  if (res.error) throw mapPostgrestError(res.error)
}

export type PushState = 'sem_suporte' | 'iphone_instalar' | 'nao_configurado' | 'bloqueado' | 'desligado' | 'ligado'

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

const isIos = () => typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)
const standalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true)

let keyCache: Promise<string | null> | null = null
export function getPushPublicKey(): Promise<string | null> {
  keyCache ??= fetch('/api/push/chave')
    .then((r) => (r.ok ? r.json() : { publicKey: null }))
    .then((b: { publicKey?: unknown }) => (typeof b.publicKey === 'string' ? b.publicKey : null))
    .catch(() => { keyCache = null; return null })
  return keyCache
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  } catch {
    return null
  }
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return isIos() && !standalone() ? 'iphone_instalar' : 'sem_suporte'
  if (!(await getPushPublicKey())) return 'nao_configurado'
  if (Notification.permission === 'denied') return 'bloqueado'
  const reg = await navigator.serviceWorker.getRegistration('/')
  const sub = await reg?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'ligado' : 'desligado'
}

function keyBytes(b64url: string): ArrayBuffer {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4)
  const bin = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

/** Pede permissão, cria a inscrição e grava no servidor. Precisa ser chamado num toque da pessoa. */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new RepositoryError('validation', 'Este navegador não oferece avisos com o app fechado.')
  const key = await getPushPublicKey()
  if (!key) throw new RepositoryError('unknown', 'Os avisos com o app fechado ainda não foram ativados pela Tucaí.')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new RepositoryError('forbidden', 'Permita as notificações da Tucaí nas configurações do navegador.')
  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready)
  await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) })
  await exec(supabase.rpc('push_subscribe', { _endpoint: sub.endpoint }))
}

export async function disablePush(): Promise<void> {
  const reg = pushSupported() ? await navigator.serviceWorker.getRegistration('/') : undefined
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await exec(supabase.rpc('push_unsubscribe', { _endpoint: sub.endpoint }))
  await sub.unsubscribe().catch(() => false)
}
