/**
 * Aviso de corrida nova por Web Push (gratuito, padrão aberto dos navegadores).
 *  * GET /api/push/chave: chave PÚBLICA VAPID para o celular criar a inscrição (null se não configurada).
 *  * Cron (a cada minuto): pergunta ao banco quem deve ser avisado (worker_offer_pushes, com a chave de integração)
 *    e envia um push SEM conteúdo. Nenhum dado do pedido passa pelo serviço de push; o celular mostra um aviso fixo.
 * Segredos no Cloudflare: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (gerados no painel Master) e PAYMENTS_INTEGRATION_KEY.
 */
import { db, type PaymentsEnv } from './payments'

export interface PushEnv extends PaymentsEnv {
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  SITE_URL?: string
}

/** Só serviços de push conhecidos (igual à regra do banco). */
export const PUSH_HOST = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)\//

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })

export function b64urlToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
export function bytesToB64url(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const textB64url = (t: string) => bytesToB64url(new TextEncoder().encode(t))

/** Chaves válidas: pública = ponto P-256 não comprimido (65 bytes), privada = 32 bytes. */
export function vapidKeys(env: PushEnv): { pub: string; priv: string; x: string; y: string } | null {
  const pub = env.VAPID_PUBLIC_KEY?.trim()
  const priv = env.VAPID_PRIVATE_KEY?.trim()
  if (!pub || !priv) return null
  try {
    const p = b64urlToBytes(pub)
    const d = b64urlToBytes(priv)
    if (p.length !== 65 || p[0] !== 4 || d.length !== 32) return null
    return { pub, priv, x: bytesToB64url(p.slice(1, 33)), y: bytesToB64url(p.slice(33)) }
  } catch {
    return null
  }
}

/** Token VAPID (JWT ES256) para a origem do serviço de push. */
export async function vapidJwt(keys: { priv: string; x: string; y: string }, audience: string, subject: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: keys.priv, x: keys.x, y: keys.y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const head = textB64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const body = textB64url(JSON.stringify({ aud: audience, exp: nowSec + 12 * 3600, sub: subject }))
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${body}`)))
  return `${head}.${body}.${bytesToB64url(sig)}`
}

export async function handlePush(request: Request, env: PushEnv): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== '/api/push/chave') return null
  if (request.method !== 'GET') return json({ error: 'method' }, 405)
  const k = vapidKeys(env)
  return json({ publicKey: k ? k.pub : null })
}

export interface PushRun { enviados: number; removidos: number; falhas: number; motivo?: string }

/** Executado pelo Cron Trigger. */
export async function sendOfferPushes(env: PushEnv, fetcher: typeof fetch = fetch): Promise<PushRun> {
  const keys = vapidKeys(env)
  if (!keys) return { enviados: 0, removidos: 0, falhas: 0, motivo: 'sem_chaves_vapid' }
  if (!env.PAYMENTS_INTEGRATION_KEY) return { enviados: 0, removidos: 0, falhas: 0, motivo: 'sem_chave_integracao' }
  const d = db(env, fetcher)
  const r = await d.rpc<{ endpoint: string }[]>('worker_offer_pushes', { _key: env.PAYMENTS_INTEGRATION_KEY })
  if (!r.ok || !r.data) return { enviados: 0, removidos: 0, falhas: 0, motivo: `banco_${r.status}` }
  const subject = (env.SITE_URL || 'https://plataforma-sucess.marcossonopi.workers.dev').replace(/\/$/, '')
  const jwtByOrigin = new Map<string, string>()
  const run: PushRun = { enviados: 0, removidos: 0, falhas: 0 }
  await Promise.all(r.data.slice(0, 500).map(async ({ endpoint }) => {
    if (!PUSH_HOST.test(endpoint)) return
    const origin = new URL(endpoint).origin
    let jwt = jwtByOrigin.get(origin)
    if (!jwt) { jwt = await vapidJwt(keys, origin, subject); jwtByOrigin.set(origin, jwt) }
    try {
      const res = await fetcher(endpoint, {
        method: 'POST',
        headers: { Authorization: `vapid t=${jwt}, k=${keys.pub}`, TTL: '300', Urgency: 'high', Topic: 'corrida' },
      })
      if (res.status === 404 || res.status === 410) {
        await d.rpc('worker_push_gone', { _key: env.PAYMENTS_INTEGRATION_KEY, _endpoint: endpoint })
        run.removidos++
      } else if (res.ok) run.enviados++
      else run.falhas++
    } catch {
      run.falhas++
    }
  }))
  return run
}
