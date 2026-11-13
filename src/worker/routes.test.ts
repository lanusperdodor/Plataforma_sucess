import { describe, expect, it, vi } from 'vitest'
import { fetchRoute, handleRoutes, simplify } from './routes'

const TOKEN = 'a.b.c'
const ORDER = '11111111-2222-3333-4444-555555555555'
const req = (body: unknown, init: RequestInit = {}) =>
  new Request('https://tucai.test/api/rota', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...init })

function fakeFetch(handlers: Record<string, (init?: RequestInit) => Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input)
    const key = Object.keys(handlers).find((k) => u.includes(k))
    if (!key) throw new Error('rede inesperada: ' + u)
    return handlers[key]!(init)
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}
const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

describe('rota de entrega no Worker', () => {
  it('ignora outros caminhos e exige POST com token', async () => {
    expect(await handleRoutes(new Request('https://tucai.test/api/outra'), {})).toBeNull()
    expect((await handleRoutes(new Request('https://tucai.test/api/rota'), {}))!.status).toBe(405)
    expect((await handleRoutes(req({ order: ORDER, leg: 'coleta' }, { headers: {} }), {}))!.status).toBe(401)
    expect((await handleRoutes(req({ order: 'x', leg: 'coleta' }), {}))!.status).toBe(400)
    expect((await handleRoutes(req({ order: ORDER, leg: 'outra' }), {}))!.status).toBe(400)
  })

  it('não chama o provedor quando o banco recusa (permissão ou limite)', async () => {
    const f = fakeFetch({ '/rpc/route_request': () => ok({ code: 'P0001', message: 'Limite de rotas desta entrega atingido; use o Google Maps.' }, 400) })
    const r = await handleRoutes(req({ order: ORDER, leg: 'coleta' }), { ORS_API_KEY: 'k' }, f)
    expect(r!.status).toBe(409)
    expect(await r!.json()).toEqual({ erro: 'Limite de rotas desta entrega atingido; use o Google Maps.' })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('sem chave do provedor: avisa e não grava', async () => {
    const f = fakeFetch({ '/rpc/route_request': () => ok({ ticket: 't', origin: { lat: -20.07, lng: -44.57 }, destination: { lat: -20.08, lng: -44.58 } }) })
    const r = await handleRoutes(req({ order: ORDER, leg: 'coleta' }), {}, f)
    expect(r!.status).toBe(503)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('fluxo completo com openrouteservice: chave só no servidor, rota gravada com o bilhete', async () => {
    let stored: Record<string, unknown> | null = null
    let orsAuth: string | null = null
    const f = fakeFetch({
      '/rpc/route_request': () => ok({ ticket: 'bilhete-1', origin: { lat: -20.07, lng: -44.57 }, destination: { lat: -20.08, lng: -44.58 } }),
      'openrouteservice.org': (init) => {
        orsAuth = new Headers(init?.headers).get('Authorization')
        expect(JSON.parse(String(init?.body)).coordinates).toEqual([[-44.57, -20.07], [-44.58, -20.08]])
        return ok({ features: [{ geometry: { coordinates: [[-44.57, -20.07], [-44.575, -20.075], [-44.58, -20.08]] }, properties: { summary: { distance: 1543.2, duration: 301.7 } } }] })
      },
      '/rpc/route_store': (init) => { stored = JSON.parse(String(init?.body)); return ok(null) },
    })
    const r = await handleRoutes(req({ order: ORDER, leg: 'entrega' }), { ORS_API_KEY: 'segredo-ors' }, f)
    expect(r!.status).toBe(200)
    expect(await r!.json()).toEqual({ distance_m: 1543, duration_s: 302, provider: 'openrouteservice', points: 3 })
    expect(orsAuth).toBe('segredo-ors')
    expect(stored).toMatchObject({ _ticket: 'bilhete-1', _distance_m: 1543, _duration_s: 302, _provider: 'openrouteservice' })
    // o token do usuário é repassado ao banco (RLS e permissões valem); a chave do provedor nunca vai ao banco
    const calls = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls
    for (const [u, init] of calls.filter(([u]) => u.includes('/rpc/'))) {
      expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`)
      expect(String(init.body)).not.toContain('segredo-ors')
      expect(u).not.toContain('segredo-ors')
    }
  })

  it('Mapbox como alternativa', async () => {
    const f = fakeFetch({ 'api.mapbox.com': () => ok({ routes: [{ geometry: { coordinates: [[-44.57, -20.07], [-44.58, -20.08]] }, distance: 900, duration: 120 }] }) })
    const r = await fetchRoute({ ROUTING_PROVIDER: 'mapbox', MAPBOX_TOKEN: 'pk.x' }, [-44.57, -20.07], [-44.58, -20.08], f)
    expect(r).toMatchObject({ provider: 'mapbox', distanceM: 900, durationS: 120 })
    expect(await fetchRoute({ ROUTING_PROVIDER: 'mapbox' }, [0, 0], [1, 1], f)).toBe('sem_chave')
  })

  it('provedor fora do ar devolve null', async () => {
    const f = fakeFetch({ 'openrouteservice.org': () => new Response('erro', { status: 500 }) })
    expect(await fetchRoute({ ORS_API_KEY: 'k' }, [0, 0], [1, 1], f)).toBeNull()
  })

  it('simplifica geometria longa mantendo início e fim', () => {
    const pts = Array.from({ length: 2000 }, (_, i) => [-44 - i / 1e4, -20 - i / 1e4] as [number, number])
    const s = simplify(pts, 400)
    expect(s).toHaveLength(400)
    expect(s[0]).toEqual([-44, -20])
    expect(s.at(-1)).toEqual([-44.1999, -20.1999])
  })
})
