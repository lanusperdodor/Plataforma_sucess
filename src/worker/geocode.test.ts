import { describe, expect, it, vi } from 'vitest'
import { handleGeocode } from './geocode'

const req = (b: unknown, auth = 'Bearer a.b.c') => new Request('https://t/api/geocode', { method: 'POST', headers: { Authorization: auth }, body: JSON.stringify(b) })
const res = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })
const fake = (geo: Response) => vi.fn(async (u: RequestInfo | URL) => (String(u).includes('/auth/v1/user') ? res({ id: 'u1' }) : geo)) as unknown as typeof fetch

describe('endereço → coordenadas', () => {
  it('valida login, entrada e chave', async () => {
    expect(await handleGeocode(new Request('https://t/api/outra'), {})).toBeNull()
    expect((await handleGeocode(req({ address: 'Rua A, 1' }, ''), { ORS_API_KEY: 'k' }))!.status).toBe(401)
    expect((await handleGeocode(req({ address: 'curto' }), { ORS_API_KEY: 'k' }))!.status).toBe(400)
    expect((await handleGeocode(req({ address: 'Rua das Flores, 120 - Centro' }), {}))!.status).toBe(503)
  })
  it('endereço preciso no Brasil: devolve o ponto e manda o foco perto da loja', async () => {
    const f = fake(res({ features: [{ geometry: { coordinates: [-46.7512345, -20.7412345] }, properties: { layer: 'address', confidence: 0.9, label: 'Rua das Flores, 120, Itaú de Minas' } }] }))
    const r = await handleGeocode(req({ address: 'Rua das Flores, 120 - Centro - Itaú de Minas/MG, CEP 37975-000', near: { lat: -20.74, lng: -46.75 } }), { ORS_API_KEY: 'k' }, f)
    expect(await r!.json()).toMatchObject({ lat: -20.74123, lng: -46.75123, precisao: 'address' })
    const url = String((f as unknown as { mock: { calls: [string][] } }).mock.calls[1]![0])
    expect(url).toContain('boundary.country=BR')
    expect(url).toContain('focus.point.lat=-20.74')
  })
  it('recusa resultado impreciso (só a cidade) ou fora do Brasil', async () => {
    expect((await handleGeocode(req({ address: 'Rua Inexistente, 9 - Itaú de Minas/MG' }), { ORS_API_KEY: 'k' }, fake(res({ features: [{ geometry: { coordinates: [-46.75, -20.74] }, properties: { layer: 'locality' } }] }))))!.status).toBe(404)
    expect((await handleGeocode(req({ address: 'Rua das Flores, 120 - Lisboa' }), { ORS_API_KEY: 'k' }, fake(res({ features: [{ geometry: { coordinates: [-9.14, 38.72] }, properties: { layer: 'address' } }] }))))!.status).toBe(404)
    expect((await handleGeocode(req({ address: 'Rua das Flores, 120 - Centro' }), { ORS_API_KEY: 'k' }, fake(res({}, 429))))!.status).toBe(503)
  })
})
