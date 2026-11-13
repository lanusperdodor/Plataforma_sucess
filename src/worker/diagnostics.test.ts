import { beforeEach, describe, expect, it, vi } from 'vitest'
import { classify, handleDiagnostics, resetDiagnosticsCache, splitFor } from './diagnostics'

const PRICING = { versao: 1, faixas: [{ ate_m: 1500, entregador_cents: 500 }, { ate_m: 3000, entregador_cents: 600 }, { ate_m: 5000, entregador_cents: 700 }], tucai_cents: 100, cliente_max_cents: 500, loja_max_cents: 200 }
const get = () => new Request('https://tucai.test/api/diagnostico/frete')
const res = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })
const distances = [1200, 2600, 4400, 7100]
function fake() {
  let i = 0
  return vi.fn(async (u: RequestInfo | URL) => {
    if (String(u).includes('delivery_pricing_current')) return res(PRICING)
    const d = distances[i++ % 4]!
    return res({ features: [{ geometry: { coordinates: [[0, 0], [1, 1]] }, properties: { summary: { distance: d, duration: 60 } } }] })
  }) as unknown as typeof fetch
}
beforeEach(resetDiagnosticsCache)

describe('diagnóstico do frete (somente leitura)', () => {
  it('regra das faixas igual à do banco', () => {
    expect(splitFor(1500, PRICING)).toMatchObject({ faixa: 1, entregador: 500, cliente: 400, loja: 200, subsidio: 0 })
    expect(splitFor(1501, PRICING)).toMatchObject({ faixa: 2, entregador: 600, cliente: 500, loja: 200, subsidio: 0 })
    expect(splitFor(5000, PRICING)).toMatchObject({ faixa: 3, entregador: 700, cliente: 500, loja: 200, subsidio: 100 })
    expect(splitFor(5001, PRICING)).toMatchObject({ fora_da_area: true })
  })
  it('sem chave avisa e não chama o provedor', async () => {
    const f = fake()
    const r = await handleDiagnostics(get(), {}, f)
    expect(r!.status).toBe(503)
    expect(await r!.json()).toMatchObject({ rotas_pelas_ruas: 'sem_chave', chave_rotas_configurada: false })
  })
  it('com chave: rotas nas faixas 1/2/3; não devolve a chave; guarda 10 min', async () => {
    const f = fake()
    const r = await handleDiagnostics(get(), { ORS_API_KEY: 'segredo-123', PAYMENTS_INTEGRATION_KEY: 'k' }, f, 1_000)
    const text = await r!.text()
    expect(text).not.toContain('segredo-123')
    const b = JSON.parse(text)
    expect(b.integracao_rotas).toBe('funcionando')
    expect(b.rotas_calculadas.map((e: { faixa: number | null }) => e.faixa)).toEqual([1, 2, 3, null])
    expect(b.rotas_calculadas.map((e: { entregador: number | null }) => e.entregador)).toEqual([500, 600, 700, null])
    expect(b.chave_integracao_configurada).toBe(true)
    const again = await handleDiagnostics(get(), { ORS_API_KEY: 'segredo-123' }, f, 60_000)
    expect((await again!.json()).em_cache).toBe(true)
    expect(f).toHaveBeenCalledTimes(5)
  })
  it('um destino sem rua (404/2010) não derruba a integração', async () => {
    let i = 0
    const f = vi.fn(async (u: RequestInfo | URL) => {
      if (String(u).includes('delivery_pricing_current')) return res(PRICING)
      if (++i === 4) return res({ error: { code: 2010, message: 'Could not find routable point within a radius of 350.0 meters' } }, 404)
      return res({ features: [{ geometry: { coordinates: [[0, 0], [1, 1]] }, properties: { summary: { distance: [973, 2862, 4245][i - 1], duration: 60 } } }] })
    }) as unknown as typeof fetch
    const r = await handleDiagnostics(get(), { ORS_API_KEY: 'k' }, f)
    expect(r!.status).toBe(200)
    const b = await r!.json()
    expect(b).toMatchObject({ integracao_rotas: 'funcionando', rotas_pelas_ruas: 'ok', resumo: { rotas_calculadas: 3, pontos_sem_rua_acessivel: 1, falhas_da_api: 0 } })
    expect(b.rotas_calculadas[2]).toMatchObject({ faixa: 3, entregador: 700, cliente: 500, loja: 200, subsidio: 100 })
    expect(b.pontos_sem_rua_acessivel[0].motivo).toMatch(/sem rua acessível/)
    expect(f).toHaveBeenCalledTimes(5) // sem a consulta reserva por GET no ponto sem rua
  })
  it('separa falha real da API (limite) de ponto sem rua', async () => {
    let i = 0
    const f = vi.fn(async (u: RequestInfo | URL) => {
      if (String(u).includes('delivery_pricing_current')) return res(PRICING)
      i++
      if (i <= 2) return res({ features: [{ geometry: { coordinates: [[0, 0], [1, 1]] }, properties: { summary: { distance: 900, duration: 60 } } }] })
      return res({ error: 'Rate limit exceeded' }, 429)
    }) as unknown as typeof fetch
    const b = await (await handleDiagnostics(get(), { ORS_API_KEY: 'k' }, f))!.json()
    expect(b).toMatchObject({ integracao_rotas: 'funcionando', rotas_pelas_ruas: 'parcial', resumo: { rotas_calculadas: 2, pontos_sem_rua_acessivel: 0, falhas_da_api: 2 } })
    expect(b.falhas_da_api[0].motivo).toMatch(/limite/)
  })
  it('classificação', () => {
    expect(classify({ status: 404, code: 2010 })).toBe('sem_rua')
    expect(classify({ status: 404, code: 2009 })).toBe('sem_rua')
    expect(classify({ status: 403 })).toBe('falha_api')
    expect(classify({ status: 500 })).toBe('falha_api')
    expect(classify(null)).toBe('falha_api')
  })
})

describe('diagnóstico: motivo da recusa', () => {
  it('mostra o código do provedor sem a chave', async () => {
    const f = vi.fn(async (u: RequestInfo | URL) => String(u).includes('delivery_pricing_current') ? res(PRICING) : res({ error: 'Access to this API has been disallowed segredo-123-abcdefghijklmnopqrstuvwxyz' }, 403)) as unknown as typeof fetch
    const r = await handleDiagnostics(get(), { ORS_API_KEY: 'segredo-123-abcdefghijklmnopqrstuvwxyz' }, f)
    const text = await r!.text()
    expect(text).not.toContain('segredo-123-abcdefghijklmnopqrstuvwxyz')
    const b = JSON.parse(text)
    expect(b.integracao_rotas).toBe('com_falha')
    expect(r!.status).toBe(503)
    expect(b.falhas_da_api[0].resposta_do_provedor.status).toBe(403)
    expect(b.formato_chave_rotas).toEqual({ tamanho: 38, tem_espaco_ou_quebra_de_linha: false, tem_aspas: false, comeca_com_bearer: false })
    expect(b.falhas_da_api[0].motivo).toMatch(/chave recusada/)
  })
})
