import { describe, expect, it, vi } from 'vitest'
import { fetchRoute, handleRoutes } from './routes'
import { orsSteps, osrmSteps, osrmText } from './steps'

describe('instruções de conversão', () => {
  it('openrouteservice: tipo, distância, ponto da manobra e texto limpo', () => {
    const coords: [number, number][] = [[-44.57, -20.07], [-44.571, -20.071], [-44.572, -20.072]]
    const s = orsSteps([{ steps: [
      { instruction: 'Siga para o norte pela <b>Rua A</b>', type: 11, distance: 120.4, way_points: [0, 1] },
      { instruction: 'Vire à direita na Av. Principal', type: 1, distance: 300, way_points: [1, 2] },
      { instruction: 'Chegue ao destino', type: 10, distance: 0, way_points: [2, 2] },
    ] }], coords)
    expect(s).toEqual([
      { text: 'Siga para o norte pela Rua A', type: 'depart', distance_m: 120, at: [-44.57, -20.07] },
      { text: 'Vire à direita na Av. Principal', type: 'turn-right', distance_m: 300, at: [-44.571, -20.071] },
      { text: 'Chegue ao destino', type: 'arrive', distance_m: 0, at: [-44.572, -20.072] },
    ])
    expect(orsSteps(null, coords)).toEqual([])
  })
  it('OSRM: texto em português gerado a partir da manobra', () => {
    expect(osrmText('turn', 'right', 'Rua das Flores')).toBe('Vire à direita na Rua das Flores')
    expect(osrmText('turn', 'slight left', '')).toBe('Vire levemente à esquerda')
    expect(osrmText('roundabout', undefined, 'Av. Brasil', 2)).toBe('Na rotatória, pegue a 2ª saída na Av. Brasil')
    expect(osrmText('arrive', undefined, '')).toBe('Você chegou ao destino')
    expect(osrmText('turn', 'uturn', '')).toBe('Faça o retorno')
    const s = osrmSteps([{ steps: [
      { name: 'Rua A', distance: 50, maneuver: { type: 'depart', location: [-44.57, -20.07] } },
      { name: 'Rua B', distance: 200, maneuver: { type: 'turn', modifier: 'left', location: [-44.571, -20.071] } },
    ] }])
    expect(s.map((x) => [x.type, x.text])).toEqual([['depart', 'Siga pela Rua A'], ['turn-left', 'Vire à esquerda na Rua B']])
  })
  it('pede as instruções em português ao openrouteservice e devolve os passos', async () => {
    let body: Record<string, unknown> = {}
    const f = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ features: [{ geometry: { coordinates: [[-44.57, -20.07], [-44.58, -20.08]] },
        properties: { summary: { distance: 1500, duration: 300 }, segments: [{ steps: [{ instruction: 'Vire à esquerda', type: 0, distance: 1500, way_points: [0, 1] }] }] } }] }))
    }) as unknown as typeof fetch
    const r = await fetchRoute({ ORS_API_KEY: 'k' }, [-44.57, -20.07], [-44.58, -20.08], f)
    expect(body).toMatchObject({ instructions: true, language: 'pt' })
    expect(r && r !== 'sem_chave' ? r.steps[0] : null).toMatchObject({ type: 'turn-left', distance_m: 1500 })
  })
  it('banco sem a 0046: grava a rota sem as instruções (não quebra)', async () => {
    const calls: Record<string, unknown>[] = []
    const f = vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => {
      const url = String(u)
      if (url.includes('route_request')) return new Response(JSON.stringify({ ticket: 't1', origin: { lat: -20.07, lng: -44.57 }, destination: { lat: -20.08, lng: -44.58 } }))
      if (url.includes('route_store')) {
        const b = JSON.parse(String(init?.body)) as Record<string, unknown>
        calls.push(b)
        return '_steps' in b ? new Response(JSON.stringify({ code: 'PGRST202', message: 'Could not find the function' }), { status: 404 }) : new Response('null')
      }
      return new Response(JSON.stringify({ features: [{ geometry: { coordinates: [[-44.57, -20.07], [-44.58, -20.08]] }, properties: { summary: { distance: 1500, duration: 300 }, segments: [] } }] }))
    }) as unknown as typeof fetch
    const req = new Request('https://t/api/rota', { method: 'POST', headers: { Authorization: 'Bearer a.b.c' }, body: JSON.stringify({ order: '11111111-2222-3333-4444-555555555555', leg: 'coleta' }) })
    const r = await handleRoutes(req, { ORS_API_KEY: 'k' }, f)
    expect(r!.status).toBe(200)
    expect(calls).toHaveLength(2)
    expect('_steps' in calls[1]!).toBe(false)
  })
})
