import { db, type PaymentsEnv } from './payments'

/**
 * GET /api/health — saúde pública e mínima: o Worker responde e consegue falar com o banco.
 * Devolve só o estado da plataforma (normal/preparando/manutencao), sem dados internos. 503 se o banco não responder.
 * Funciona mesmo em manutenção (não grava nada) e serve para monitoramento externo.
 */
export async function handleHealth(req: Request, env: PaymentsEnv, fetcher: typeof fetch = fetch): Promise<Response | null> {
  const path = new URL(req.url).pathname
  if (path !== '/api/health') return null
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } })
  const started = Date.now()
  const r = await db(env, fetcher).rpc<{ mode?: string }>('platform_status', {})
  const body = r.ok && r.data
    ? { ok: true, worker: 'ok', db: 'ok', mode: r.data.mode ?? 'normal', ms: Date.now() - started }
    : { ok: false, worker: 'ok', db: 'indisponivel', mode: null, ms: Date.now() - started }
  return new Response(req.method === 'HEAD' ? null : JSON.stringify(body), {
    status: body.ok ? 200 : 503,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  })
}
