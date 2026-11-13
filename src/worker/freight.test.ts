import { describe, expect, it, vi } from 'vitest'
import { handleFreight } from './freight'

const TOKEN = 'a.b.c'
const BIZ = '11111111-2222-3333-4444-555555555555'
const KEY = 'k'.repeat(40)
const req = (body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` }) =>
  new Request('https://tucai.test/api/frete', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
function fake(h: Record<string, (init?: RequestInit) => Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input)
    const k = Object.keys(h).find((x) => u.includes(x))
    if (!k) throw new Error('rede inesperada: ' + u)
    return h[k]!(init)
  }) as unknown as typeof fetch
}

describe('frete por distância no Worker', () => {
  it('valida entrada e login', async () => {
    expect(await handleFreight(new Request('https://tucai.test/api/outra'), {})).toBeNull()
    expect((await handleFreight(req({ business: BIZ, lat: -20, lng: -44 }, {}), {}))!.status).toBe(401)
    expect((await handleFreight(req({ business: BIZ, lat: 40, lng: -74 }), {}))!.status).toBe(400) // fora do Brasil
    expect((await handleFreight(req({ business: BIZ, lat: -20, lng: -44 }), {}))!.status).toBe(503) // sem chave de integração
  })

  it('fluxo completo: Auth confere o cliente, rota por ruas e cotação gravada com a chave (nunca com o token do usuário)', async () => {
    let stored: Record<string, unknown> | null = null
    let storeAuth: string | null = null
    const f = fake({
      '/auth/v1/user': (init) => { expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`); return ok({ id: 'cliente-1' }) },
      '/rpc/worker_business_point': () => ok({ lat: -20.07, lng: -44.57, delivery_offer: 'partner' }),
      'openrouteservice.org': () => ok({ features: [{ geometry: { coordinates: [[-44.57, -20.07], [-44.58, -20.08]] }, properties: { summary: { distance: 2412.4, duration: 410 } } }] }),
      '/rpc/worker_store_delivery_quote': (init) => {
        stored = JSON.parse(String(init?.body)); storeAuth = new Headers(init?.headers).get('Authorization')
        return ok({ quote_id: 'q1', fora_da_area: false, distancia_m: 2412, split: { cliente_cents: 500, loja_cents: 200, entregador_cents: 600 } })
      },
    })
    const r = await handleFreight(req({ business: BIZ, lat: -20.08, lng: -44.58 }), { PAYMENTS_INTEGRATION_KEY: KEY, ORS_API_KEY: 'ors' }, f)
    expect(r!.status).toBe(200)
    expect(await r!.json()).toMatchObject({ quote_id: 'q1', split: { cliente_cents: 500 } })
    expect(stored).toMatchObject({ _key: KEY, _customer: 'cliente-1', _business: BIZ, _distance_m: 2412, _provider: 'openrouteservice' })
    expect(storeAuth).not.toContain(TOKEN)
  })

  it('token inválido não grava cotação', async () => {
    const f = fake({ '/auth/v1/user': () => ok({ msg: 'invalid' }, 401) })
    const r = await handleFreight(req({ business: BIZ, lat: -20.08, lng: -44.58 }), { PAYMENTS_INTEGRATION_KEY: KEY, ORS_API_KEY: 'ors' }, f)
    expect(r!.status).toBe(401)
  })

  it('loja sem ponto no mapa ou sem provedor de rotas: avisa e usa o frete padrão', async () => {
    const semPonto = fake({ '/auth/v1/user': () => ok({ id: 'c' }), '/rpc/worker_business_point': () => ok({ lat: null, lng: null, delivery_offer: 'partner' }) })
    expect((await handleFreight(req({ business: BIZ, lat: -20.08, lng: -44.58 }), { PAYMENTS_INTEGRATION_KEY: KEY }, semPonto))!.status).toBe(409)
    const semRota = fake({ '/auth/v1/user': () => ok({ id: 'c' }), '/rpc/worker_business_point': () => ok({ lat: -20, lng: -44, delivery_offer: 'partner' }) })
    expect((await handleFreight(req({ business: BIZ, lat: -20.08, lng: -44.58 }), { PAYMENTS_INTEGRATION_KEY: KEY }, semRota))!.status).toBe(503)
  })
})
