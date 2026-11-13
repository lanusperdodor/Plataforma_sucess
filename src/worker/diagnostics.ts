/**
 * GET /api/diagnostico/frete — teste SOMENTE LEITURA do frete por distância em produção.
 * Calcula, no provedor de rotas configurado (chave só no Worker), a distância pelas ruas de 4 trajetos fixos de exemplo
 * (Passos/MG) e mostra em que faixa da tabela vigente (delivery_pricing_current, pública) cada um cai.
 * Não grava nada no banco, não usa dados de clientes nem de lojas e nunca devolve a chave.
 * Para não gastar a cota do provedor, o resultado fica guardado por 10 minutos em cada instância do Worker.
 */
import { SUPABASE_PUBLIC } from '../config/supabase-public'
import { fetchRoute, type RouteFailure, type RoutesEnv } from './routes'

export interface DiagnosticsEnv extends RoutesEnv { PAYMENTS_INTEGRATION_KEY?: string }
type LngLat = [number, number]

const ORIGEM: LngLat = [-46.6098, -20.7189] // centro de Passos/MG (exemplo fixo)
const DESTINOS: { nome: string; ponto: LngLat }[] = [
  { nome: 'perto', ponto: [-46.6018, -20.7189] },
  { nome: 'médio', ponto: [-46.5898, -20.7189] },
  { nome: 'longe', ponto: [-46.5778, -20.7189] },
  // ponto de controle de propósito sem rua por perto: deve sair como "sem rua acessível", não como falha
  { nome: 'controle: ponto sem rua', ponto: [-46.5498, -20.7189] },
]
const TTL_MS = 10 * 60_000
let cache: { at: number; body: unknown } | null = null

interface Pricing { faixas: { ate_m: number; entregador_cents: number }[]; tucai_cents: number; cliente_max_cents: number; loja_max_cents: number; versao: number }

/** Mesma regra de private.delivery_split (0040), só para exibir o diagnóstico. */
export function splitFor(distanceM: number, p: Pricing) {
  const i = p.faixas.findIndex((f) => distanceM <= f.ate_m)
  if (i < 0) return { faixa: null, entregador: null, tucai: null, cliente: null, loja: null, subsidio: null, fora_da_area: true }
  const entregador = p.faixas[i]!.entregador_cents
  const custo = entregador + p.tucai_cents
  const loja = Math.min(p.loja_max_cents, custo)
  const cliente = Math.min(p.cliente_max_cents, custo - loja)
  return { faixa: i + 1, entregador, tucai: p.tucai_cents, cliente, loja, subsidio: custo - loja - cliente, fora_da_area: false }
}

/** Destino sem rua (o provedor respondeu e recusou o PONTO) × falha real da API (chave, limite, queda, rede). */
export function classify(f: RouteFailure | null): 'sem_rua' | 'falha_api' {
  if (!f) return 'falha_api'
  // openrouteservice: 2010 = sem ponto roteável perto; 2009 = sem rota entre os pontos; 2004 = distância acima do limite do plano
  if (f.code === 2010 || f.code === 2009 || (f.status === 404 && f.code === undefined)) return 'sem_rua'
  return 'falha_api'
}

/** Tradução simples do erro do openrouteservice. */
export function motivo(f: RouteFailure | null): string {
  if (!f) return 'sem detalhe'
  if (f.status === 401 || f.status === 403) return 'chave recusada pelo openrouteservice (chave errada, copiada com espaço/aspas, ou ainda não ativada)'
  if (f.status === 429) return 'limite diário/por minuto do plano gratuito atingido'
  if (f.code === 2009) return 'não existe caminho por ruas entre os dois pontos'
  if (f.status === 404 || f.code === 2010) return 'destino sem rua acessível num raio de 350 m (o ponto, não a integração)'
  if (f.status === 400 && !f.message) return 'pedido recusado sem explicação (confira o formato da chave abaixo e se ela é do openrouteservice.org)'
  if (f.status === 0) return 'sem conexão com o openrouteservice'
  if (f.status >= 500) return 'openrouteservice fora do ar no momento'
  return 'pedido recusado pelo openrouteservice'
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })

export async function handleDiagnostics(req: Request, env: DiagnosticsEnv, fetcher: typeof fetch = fetch, now = Date.now()): Promise<Response | null> {
  if (new URL(req.url).pathname !== '/api/diagnostico/frete') return null
  if (req.method !== 'GET') return json({ erro: 'Método não permitido.' }, 405)
  if (cache && now - cache.at < TTL_MS) return json({ ...(cache.body as object), em_cache: true })

  const base = (env.SUPABASE_URL || SUPABASE_PUBLIC.url).replace(/\/$/, '')
  const apikey = env.SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLIC.publishableKey
  let pricing: Pricing | null = null
  try {
    const r = await fetcher(`${base}/rest/v1/rpc/delivery_pricing_current`, { method: 'POST', headers: { apikey, Authorization: `Bearer ${apikey}`, 'Content-Type': 'application/json' }, body: '{}' })
    if (r.ok) pricing = (await r.json()) as Pricing
  } catch { /* sem banco */ }

  const provider = (env.ROUTING_PROVIDER || 'ors').toLowerCase()
  const calculadas: unknown[] = []
  const semRua: unknown[] = []
  const falhasApi: unknown[] = []
  let semChave = false
  for (const d of DESTINOS) {
    const falhas: RouteFailure[] = []
    const r = await fetchRoute(env, ORIGEM, d.ponto, fetcher, (f) => { falhas.push(f) })
    if (r === 'sem_chave') { semChave = true; break }
    if (r) { calculadas.push({ trajeto: d.nome, distancia_ruas_m: r.distanceM, tempo_s: r.durationS, provedor: r.provider, ...(pricing ? splitFor(r.distanceM, pricing) : {}) }); continue }
    const f = falhas[falhas.length - 1] ?? null
    const item = { trajeto: d.nome, resposta_do_provedor: f, motivo: motivo(f) }
    if (classify(f) === 'sem_rua') semRua.push(item)
    else falhasApi.push(item)
  }
  // a integração funciona quando o provedor respondeu de verdade (rota calculada ou "ponto sem rua"): um destino ruim não derruba tudo
  const integracao = semChave ? 'sem_chave' : calculadas.length > 0 || (semRua.length > 0 && falhasApi.length === 0) ? 'funcionando' : 'com_falha'
  const estado: 'ok' | 'parcial' | 'sem_chave' | 'falhou' = semChave ? 'sem_chave' : integracao === 'com_falha' ? 'falhou' : falhasApi.length > 0 ? 'parcial' : 'ok'
  const body = {
    integracao_rotas: integracao,
    resumo: { rotas_calculadas: calculadas.length, pontos_sem_rua_acessivel: semRua.length, falhas_da_api: falhasApi.length },
    rotas_pelas_ruas: estado,
    provedor_configurado: provider,
    chave_rotas_configurada: provider === 'ors' ? !!env.ORS_API_KEY : provider === 'mapbox' ? !!env.MAPBOX_TOKEN : !!env.OSRM_URL,
    chave_integracao_configurada: !!env.PAYMENTS_INTEGRATION_KEY,
    // só o formato (nunca o valor): ajuda a achar chave colada com espaço, aspas ou "Bearer"
    formato_chave_rotas: env.ORS_API_KEY ? {
      tamanho: env.ORS_API_KEY.length,
      tem_espaco_ou_quebra_de_linha: /\s/.test(env.ORS_API_KEY),
      tem_aspas: /["']/.test(env.ORS_API_KEY),
      comeca_com_bearer: /^\s*bearer/i.test(env.ORS_API_KEY),
    } : null,
    tabela_vigente: pricing ? { versao: pricing.versao, faixas: pricing.faixas, tucai_cents: pricing.tucai_cents, cliente_max_cents: pricing.cliente_max_cents, loja_max_cents: pricing.loja_max_cents } : 'indisponível (migração 0040 pendente?)',
    rotas_calculadas: calculadas,
    pontos_sem_rua_acessivel: semRua,
    falhas_da_api: falhasApi,
    observacao: 'Teste somente leitura com trajetos fixos de exemplo. Nada é gravado. "Ponto sem rua" é o destino, não a integração.',
    gerado_em: new Date(now).toISOString(),
  }
  if (estado === 'ok' || estado === 'parcial') cache = { at: now, body }
  return json(body, integracao === 'funcionando' ? 200 : 503)
}

/** só para testes */
export const resetDiagnosticsCache = () => { cache = null }
