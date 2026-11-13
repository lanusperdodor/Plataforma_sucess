import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleDiagnostics, resetDiagnosticsCache, splitFor } from './diagnostics'

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
  it('com chave: 4 rotas, faixas 1/2/3 e fora da área; não devolve a chave; guarda 10 min', async () => {
    const f = fake()
    const r = await handleDiagnostics(get(), { ORS_API_KEY: 'segredo-123', PAYMENTS_INTEGRATION_KEY: 'k' }, f, 1_000)
    const text = await r!.text()
    expect(text).not.toContain('segredo-123')
    const b = JSON.parse(text)
    expect(b.rotas_pelas_ruas).toBe('ok')
    expect(b.exemplos.map((e: { faixa: number | null }) => e.faixa)).toEqual([1, 2, 3, null])
    expect(b.exemplos.map((e: { entregador: number | null }) => e.entregador)).toEqual([500, 600, 700, null])
    expect(b.chave_integracao_configurada).toBe(true)
    const again = await handleDiagnostics(get(), { ORS_API_KEY: 'segredo-123' }, f, 60_000)
    expect((await again!.json()).em_cache).toBe(true)
    expect(f).toHaveBeenCalledTimes(5)
  })
})

describe('diagnóstico: motivo da recusa', () => {
  it('mostra o código do provedor sem a chave', async () => {
    const f = vi.fn(async (u: RequestInfo | URL) => String(u).includes('delivery_pricing_current') ? res(PRICING) : res({ error: 'Access to this API has been disallowed segredo-123-abcdefghijklmnopqrstuvwxyz' }, 403)) as unknown as typeof fetch
    const r = await handleDiagnostics(get(), { ORS_API_KEY: 'segredo-123-abcdefghijklmnopqrstuvwxyz' }, f)
    const text = await r!.text()
    expect(text).not.toContain('segredo-123-abcdefghijklmnopqrstuvwxyz')
    const b = JSON.parse(text)
    expect(b.exemplos[0].resposta_do_provedor.status).toBe(403)
    expect(b.exemplos[0].motivo_provavel).toMatch(/chave recusada/)
  })
})
