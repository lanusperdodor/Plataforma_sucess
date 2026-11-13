/**
 * Consulta de CEP para os formulários de endereço:  GET /api/cep/37975000
 * Pergunta à BrasilAPI e, se falhar, ao ViaCEP (ambos públicos, sem chave). Responde só cidade/UF/rua/bairro
 * normalizados, com cache de 1 dia na borda. Assim o site não precisa liberar esses domínios na CSP.
 */
const json = (body: unknown, status = 200, cache = 'no-store') =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache, 'X-Robots-Tag': 'noindex' } })

export interface CepAnswer { cep: string; street: string; district: string; city: string; uf: string }
const clean = (v: unknown, max: number) => (typeof v === 'string' ? [...v].filter((c) => c >= ' ' && c !== '<' && c !== '>').join('').trim().slice(0, max) : '')

async function brasilApi(cep: string, f: typeof fetch): Promise<CepAnswer | 'nao_existe' | null> {
  try {
    const r = await f(`https://brasilapi.com.br/api/cep/v1/${cep}`, { headers: { Accept: 'application/json' } })
    if (r.status === 404) return 'nao_existe'
    if (!r.ok) return null
    const d = (await r.json()) as Record<string, unknown>
    return { cep, street: clean(d.street, 120), district: clean(d.neighborhood, 80), city: clean(d.city, 80), uf: clean(d.state, 2).toUpperCase() }
  } catch { return null }
}

async function viaCep(cep: string, f: typeof fetch): Promise<CepAnswer | 'nao_existe' | null> {
  try {
    const r = await f(`https://viacep.com.br/ws/${cep}/json/`, { headers: { Accept: 'application/json' } })
    if (!r.ok) return r.status === 400 ? 'nao_existe' : null
    const d = (await r.json()) as Record<string, unknown>
    if (d.erro) return 'nao_existe'
    return { cep, street: clean(d.logradouro, 120), district: clean(d.bairro, 80), city: clean(d.localidade, 80), uf: clean(d.uf, 2).toUpperCase() }
  } catch { return null }
}

export async function handleCep(req: Request, fetcher: typeof fetch = fetch): Promise<Response | null> {
  const m = /^\/api\/cep\/([^/]*)$/.exec(new URL(req.url).pathname)
  if (!m) return null
  if (req.method !== 'GET') return json({ erro: 'Método não permitido.' }, 405)
  const cep = m[1]!
  if (!/^\d{8}$/.test(cep)) return json({ erro: 'CEP inválido.' }, 400)
  let a = await brasilApi(cep, fetcher)
  if (a === null || (a !== 'nao_existe' && !a.city)) {
    const b = await viaCep(cep, fetcher)
    if (b !== null) a = b
  }
  if (a === 'nao_existe') return json({ erro: 'CEP não encontrado.' }, 404, 'public, max-age=3600')
  if (!a || !a.city || a.uf.length !== 2) return json({ erro: 'Serviço de CEP indisponível.' }, 502)
  return json(a, 200, 'public, max-age=86400')
}
