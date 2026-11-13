import { describe, expect, it, vi } from 'vitest'
import { handleCep } from './cep'

const get = (cep: string, method = 'GET') => new Request(`https://tucai.test/api/cep/${cep}`, { method })
const res = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
const fake = (h: (u: string) => Response | Promise<Response>) => vi.fn(async (i: RequestInfo | URL) => h(String(i))) as unknown as typeof fetch

describe('consulta de CEP no Worker', () => {
  it('ignora outras rotas e valida o CEP', async () => {
    expect(await handleCep(new Request('https://tucai.test/api/frete'))).toBeNull()
    expect((await handleCep(get('123')))!.status).toBe(400)
    expect((await handleCep(get('37975000', 'POST')))!.status).toBe(405)
  })
  it('usa a BrasilAPI e normaliza', async () => {
    const f = fake(() => res({ cep: '37975000', state: 'mg', city: 'Itaú de Minas', neighborhood: 'Centro', street: 'Rua A <b>' }))
    const r = await handleCep(get('37975000'), f)
    expect(r!.status).toBe(200)
    expect(await r!.json()).toEqual({ cep: '37975000', street: 'Rua A b', district: 'Centro', city: 'Itaú de Minas', uf: 'MG' })
    expect(r!.headers.get('Cache-Control')).toContain('max-age=86400')
  })
  it('cai para o ViaCEP quando a BrasilAPI falha', async () => {
    const f = fake((u) => (u.includes('brasilapi') ? res({}, 500) : res({ logradouro: '', bairro: '', localidade: 'Itaú de Minas', uf: 'MG' })))
    expect(await (await handleCep(get('37975000'), f))!.json()).toMatchObject({ city: 'Itaú de Minas', uf: 'MG', street: '' })
  })
  it('CEP inexistente dá 404; serviços fora dão 502', async () => {
    expect((await handleCep(get('00000000'), fake((u) => (u.includes('brasilapi') ? res({}, 404) : res({ erro: true })))))!.status).toBe(404)
    expect((await handleCep(get('37975000'), fake(() => { throw new Error('rede') })))!.status).toBe(502)
  })
})
