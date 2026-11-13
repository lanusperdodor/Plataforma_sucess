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
  { nome: 'fora da área', ponto: [-46.5498, -20.7189] },
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

/** Tradução simples do erro do openrouteservice. */
export function motivo(f: RouteFailure | null): string {
  if (!f) return 'sem detalhe'
  if (f.status === 401 || f.status === 403) return 'chave recusada pelo openrouteservice (chave errada, copiada com espaço/aspas, ou ainda não ativada)'
  if (f.status === 429) return 'limite diário/por minuto do plano gratuito atingido'
  if (f.status === 404 || f.code === 2010) return 'ponto fora das ruas mapeadas'
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
  const rotas = []
  let estado: 'ok' | 'sem_chave' | 'falhou' = 'ok'
  for (const d of DESTINOS) {
    let falha: RouteFailure | null = null
    const r = await fetchRoute(env, ORIGEM, d.ponto, fetcher, (f) => { falha = f })
    if (r === 'sem_chave') { estado = 'sem_chave'; break }
    if (!r) { estado = 'falhou'; rotas.push({ trajeto: d.nome, erro: 'o provedor de rotas recusou ou não respondeu', resposta_do_provedor: falha, motivo_provavel: motivo(falha) }); continue }
    rotas.push({ trajeto: d.nome, distancia_ruas_m: r.distanceM, tempo_s: r.durationS, provedor: r.provider, ...(pricing ? splitFor(r.distanceM, pricing) : {}) })
  }
  const body = {
    rotas_pelas_ruas: estado,
    provedor_configurado: provider,
    chave_rotas_configurada: provider === 'ors' ? !!env.ORS_API_KEY : provider === 'mapbox' ? !!env.MAPBOX_TOKEN : !!env.OSRM_URL,
    chave_integracao_configurada: !!env.PAYMENTS_INTEGRATION_KEY,
    tabela_vigente: pricing ? { versao: pricing.versao, faixas: pricing.faixas, tucai_cents: pricing.tucai_cents, cliente_max_cents: pricing.cliente_max_cents, loja_max_cents: pricing.loja_max_cents } : 'indisponível (migração 0040 pendente?)',
    exemplos: rotas,
    observacao: 'Teste somente leitura com trajetos fixos de exemplo. Nada é gravado.',
    gerado_em: new Date(now).toISOString(),
  }
  if (estado === 'ok') cache = { at: now, body }
  return json(body, estado === 'ok' ? 200 : 503)
}

/** só para testes */
export const resetDiagnosticsCache = () => { cache = null }
