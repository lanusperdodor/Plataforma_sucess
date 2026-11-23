import { describe, expect, it, vi } from 'vitest'
import { handleGeocode } from './geocode'

const req = (b: unknown, auth = 'Bearer a.b.c') => new Request('https://t/api/geocode', { method: 'POST', headers: { Authorization: auth }, body: JSON.stringify(b) })
const res = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })
const fake = (geo: Response) => vi.fn(async (u: RequestInfo | URL) => (String(u).includes('/auth/v1/user') ? res({ id: 'u1' }) : String(u).includes('geocode_allow') ? res(null) : geo)) as unknown as typeof fetch

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
    const url = (f as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => String(c[0])).find((x) => x.includes('openrouteservice'))!
    expect(url).toContain('boundary.country=BR')
    expect(url).toContain('focus.point.lat=-20.74')
  })
  it('recusa resultado impreciso (só a cidade) ou fora do Brasil', async () => {
    expect((await handleGeocode(req({ address: 'Rua Inexistente, 9 - Itaú de Minas/MG' }), { ORS_API_KEY: 'k' }, fake(res({ features: [{ geometry: { coordinates: [-46.75, -20.74] }, properties: { layer: 'locality' } }] }))))!.status).toBe(404)
    expect((await handleGeocode(req({ address: 'Rua das Flores, 120 - Lisboa' }), { ORS_API_KEY: 'k' }, fake(res({ features: [{ geometry: { coordinates: [-9.14, 38.72] }, properties: { layer: 'address' } }] }))))!.status).toBe(404)
    expect((await handleGeocode(req({ address: 'Rua das Flores, 120 - Centro' }), { ORS_API_KEY: 'k' }, fake(res({}, 429))))!.status).toBe(503)
  })
  it('com as partes do endereço: tenta a busca estruturada, depois outras formas, e filtra UF errada', async () => {
    const urls: string[] = []
    const f = vi.fn(async (u: RequestInfo | URL) => {
      const url = String(u); if (url.includes('/auth/v1/user')) return res({ id: 'u1' })
      if (url.includes('geocode_allow')) return res(null)
      urls.push(url)
      if (url.includes('/search/structured')) return res({ features: [] })
      // texto completo: 1º resultado é homônimo em SP (descartado), 2º é o certo em MG
      if (url.includes('Rua+das+Flores%2C+120')) return res({ features: [
        { geometry: { coordinates: [-46.6, -23.5] }, properties: { layer: 'address', region_a: 'SP', locality: 'São Paulo' } },
        { geometry: { coordinates: [-46.7512, -20.7412] }, properties: { layer: 'street', region_a: 'MG', locality: 'Itaú de Minas' } },
      ] })
      return res({ features: [] })
    }) as unknown as typeof fetch
    const r = await handleGeocode(req({ address: 'Rua das Flores, 120, Centro, Itaú de Minas - MG', parts: { street: 'Rua das Flores', number: '120', district: 'Centro', city: 'Itaú de Minas', uf: 'MG', cep: '37975-000' } }), { ORS_API_KEY: 'k' }, f)
    expect(await r!.json()).toMatchObject({ lat: -20.7412, lng: -46.7512, aproximado: false })
    expect(urls[0]).toContain('/geocode/search/structured?')
    expect(urls[0]).toContain('locality=Ita')
    expect(urls[0]).toContain('postalcode=37975000')
  })
  it('sem achar a rua: com aproximado=true devolve o bairro marcado como aproximado', async () => {
    const f = vi.fn(async (u: RequestInfo | URL) => {
      const url = String(u); if (url.includes('/auth/v1/user')) return res({ id: 'u1' })
      if (url.includes('layers=neighbourhood')) return res({ features: [{ geometry: { coordinates: [-46.75, -20.74] }, properties: { layer: 'neighbourhood', region_a: 'MG' } }] })
      return res({ features: [] })
    }) as unknown as typeof fetch
    const parts = { street: 'Rua Nova', number: '5', district: 'Centro', city: 'Itaú de Minas', uf: 'MG', cep: '' }
    expect((await handleGeocode(req({ address: 'Rua Nova, 5, Centro, Itaú de Minas - MG', parts }), { ORS_API_KEY: 'k' }, f))!.status).toBe(404)
    const r = await handleGeocode(req({ address: 'Rua Nova, 5, Centro, Itaú de Minas - MG', parts, aproximado: true }), { ORS_API_KEY: 'k' }, f)
    expect(await r!.json()).toMatchObject({ aproximado: true, precisao: 'neighbourhood' })
  })
  it('cota (0058): passou do limite por pessoa, responde 429 sem consultar o serviço de mapas', async () => {
    const calls: string[] = []
    const f = vi.fn(async (u: RequestInfo | URL) => {
      const url = String(u); calls.push(url)
      if (url.includes('/auth/v1/user')) return res({ id: 'u1' })
      if (url.includes('geocode_allow')) return res({ code: 'PT429', message: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.' }, 400)
      return res({ features: [] })
    }) as unknown as typeof fetch
    const r = await handleGeocode(req({ address: 'Rua das Flores, 120 - Centro' }), { ORS_API_KEY: 'k' }, f)
    expect(r!.status).toBe(429)
    expect(calls.some((c) => c.includes('openrouteservice'))).toBe(false)
  })
})
