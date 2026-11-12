import { describe, expect, it } from 'vitest'
import { handleHealth } from './health'

const env = { SUPABASE_URL: 'https://db.example', SUPABASE_PUBLISHABLE_KEY: 'pk' }
const fakeFetch = (ok: boolean, data: unknown, status = ok ? 200 : 500) => (async () => new Response(JSON.stringify(data), { status })) as unknown as typeof fetch

describe('GET /api/health', () => {
  it('ignora outras rotas', async () => {
    expect(await handleHealth(new Request('https://x/api/outra'), env, fakeFetch(true, {}))).toBeNull()
  })
  it('responde 200 com o modo da plataforma, sem dados internos', async () => {
    const res = (await handleHealth(new Request('https://x/api/health'), env, fakeFetch(true, { mode: 'manutencao', eta: null })))!
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toMatchObject({ ok: true, db: 'ok', mode: 'manutencao' })
    expect(Object.keys(body).sort()).toEqual(['db', 'mode', 'ms', 'ok', 'worker'])
  })
  it('banco no ar sem a migration 0030: avisa migrações pendentes, sem acusar queda', async () => {
    const res = (await handleHealth(new Request('https://x/api/health'), env, fakeFetch(false, { code: 'PGRST202' }, 404)))!
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, db: 'migracoes_pendentes' })
  })
  it('503 quando o banco não responde', async () => {
    const res = (await handleHealth(new Request('https://x/api/health'), env, fakeFetch(false, {})))!
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ ok: false, db: 'indisponivel' })
  })
})
