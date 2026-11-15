import { describe, expect, it, vi } from 'vitest'
import { b64urlToBytes, bytesToB64url, handlePush, sendOfferPushes, vapidJwt, vapidKeys } from './push'

async function newKeys() {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
  return { VAPID_PUBLIC_KEY: bytesToB64url(raw), VAPID_PRIVATE_KEY: jwk.d!, publicKey: kp.publicKey }
}

describe('Web Push no Worker', () => {
  it('chave pública: null sem configuração, valor quando configurada', async () => {
    expect(await handlePush(new Request('https://t.test/api/outra'), {})).toBeNull()
    expect(await (await handlePush(new Request('https://t.test/api/push/chave'), {}))!.json()).toEqual({ publicKey: null })
    expect(vapidKeys({ VAPID_PUBLIC_KEY: 'abc', VAPID_PRIVATE_KEY: 'def' })).toBeNull()
    const k = await newKeys()
    const r = await handlePush(new Request('https://t.test/api/push/chave'), k)
    expect(await r!.json()).toEqual({ publicKey: k.VAPID_PUBLIC_KEY })
    expect((await handlePush(new Request('https://t.test/api/push/chave', { method: 'POST' }), k))!.status).toBe(405)
  })

  it('token VAPID assinado e verificável com a chave pública', async () => {
    const k = await newKeys()
    const keys = vapidKeys(k)!
    const jwt = await vapidJwt(keys, 'https://fcm.googleapis.com', 'https://tucai.test', 1000)
    const [h, b, s] = jwt.split('.')
    expect(JSON.parse(new TextDecoder().decode(b64urlToBytes(b!)))).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1000 + 43200, sub: 'https://tucai.test' })
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k.publicKey, b64urlToBytes(s!), new TextEncoder().encode(`${h}.${b}`))
    expect(ok).toBe(true)
  })

  it('envia push sem conteúdo, ignora hosts estranhos e remove aparelhos inexistentes', async () => {
    const k = await newKeys()
    const calls: { url: string; init?: RequestInit }[] = []
    const f = vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => {
      const url = String(i)
      calls.push({ url, init })
      if (url.includes('/rpc/worker_offer_pushes')) return new Response(JSON.stringify([
        { endpoint: 'https://fcm.googleapis.com/fcm/send/a' },
        { endpoint: 'https://fcm.googleapis.com/fcm/send/gone' },
        { endpoint: 'https://evil.example/x' },
      ]))
      if (url.includes('/rpc/worker_push_gone')) return new Response('null')
      if (url.endsWith('/gone')) return new Response('', { status: 410 })
      return new Response('', { status: 201 })
    }) as unknown as typeof fetch
    const r = await sendOfferPushes({ ...k, PAYMENTS_INTEGRATION_KEY: 'k'.repeat(40) }, f)
    expect(r).toEqual({ enviados: 1, removidos: 1, falhas: 0 })
    expect(calls.some((c) => c.url.includes('evil'))).toBe(false)
    const push = calls.find((c) => c.url.endsWith('/send/a'))!
    expect(push.init?.body).toBeUndefined()
    expect(String((push.init?.headers as Record<string, string>).Authorization)).toMatch(/^vapid t=.+\..+\..+, k=/)
    const gone = calls.find((c) => c.url.includes('worker_push_gone'))!
    expect(JSON.parse(String(gone.init?.body))._endpoint).toBe('https://fcm.googleapis.com/fcm/send/gone')
  })

  it('sem chaves não faz nada', async () => {
    const f = vi.fn() as unknown as typeof fetch
    expect((await sendOfferPushes({}, f)).motivo).toBe('sem_chaves_vapid')
    expect(f).not.toHaveBeenCalled()
  })
})
