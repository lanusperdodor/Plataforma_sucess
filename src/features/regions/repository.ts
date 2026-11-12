import { z } from 'zod'
import { rpc } from '../../lib/rpc'

/** Cobertura nacional e regiões comerciais (0028). Leituras paginadas; nada carrega todos os municípios. */
export type RegionStatus = 'rascunho' | 'ativa' | 'pausada' | 'desativada'
export const REGION_STATUS_LABEL: Record<RegionStatus, string> = { rascunho: 'Rascunho', ativa: 'Ativa', pausada: 'Pausada', desativada: 'Desativada' }

const n = z.number()
const summarySchema = z.object({
  municipios: n, com_regiao_principal: n, em_raio: n, em_regiao_ativa: n, lacunas: n, sem_coordenadas: n,
  regioes: z.record(z.string(), n).nullable(), cidades_atendidas: n, cidades_com_ibge: n, cidades_operacionais: n,
  por_uf: z.array(z.object({ sigla: z.string(), nome: z.string(), municipios: n, em_raio: n, lacunas: n, lat: n.nullable(), lng: n.nullable() })),
})
export type CoverageSummary = z.infer<typeof summarySchema>
export const getCoverageSummary = () => rpc('admin_coverage_summary', undefined, summarySchema)

const regionSchema = z.object({
  id: z.string(), name: z.string(), slug: z.string(), kind: z.enum(['raio', 'administrativa']), status: z.enum(['rascunho', 'ativa', 'pausada', 'desativada']),
  uf: z.string().nullable(), center_ibge: n.nullable(), center_name: z.string().nullable(), center_lat: n.nullable(), center_lng: n.nullable(),
  radius_km: n.nullable(), suggested: z.boolean(), municipalities: n, primary_municipalities: n, businesses: n, active_campaigns: n,
  in_use: z.boolean(), total_count: n,
})
export type Region = z.infer<typeof regionSchema>
export const listRegions = (f: { uf?: string; status?: string; q?: string; page: number; pageSize: number }) =>
  rpc('admin_regions', { _uf: f.uf || null, _status: f.status || null, _q: f.q || null, _limit: f.pageSize, _offset: (f.page - 1) * f.pageSize }, z.array(regionSchema))

const mapSchema = z.object({ id: z.string(), name: z.string(), status: z.string(), lat: n, lng: n, radius_km: n })
export type RegionCircle = z.infer<typeof mapSchema>
export const getRegionMap = () => rpc('admin_region_map', undefined, z.array(mapSchema))

const memberSchema = z.object({
  ibge_code: n, name: z.string(), uf: z.string(), distance_km: n.nullable(), source: z.string(), excluded: z.boolean(), is_primary: z.boolean(),
  primary_region: z.string().nullable(), served_city: z.boolean(), businesses: n, total_count: n,
})
export type RegionMember = z.infer<typeof memberSchema>
export const listRegionMunicipalities = (region: string, q: string, page: number, pageSize: number) =>
  rpc('admin_region_municipalities', { _region: region, _q: q || null, _limit: pageSize, _offset: (page - 1) * pageSize }, z.array(memberSchema))

const uncoveredSchema = z.object({ ibge_code: n, name: z.string(), uf: z.string(), lat: n.nullable(), lng: n.nullable(), reason: z.string(), total_count: n })
export const listUncovered = (uf: string, q: string, page: number, pageSize: number) =>
  rpc('admin_uncovered_municipalities', { _uf: uf || null, _q: q || null, _limit: pageSize, _offset: (page - 1) * pageSize }, z.array(uncoveredSchema))

const muniSchema = z.object({ ibge_code: n, name: z.string(), uf: z.string(), lat: n.nullable(), lng: n.nullable(), is_capital: z.boolean() })
export type Municipality = z.infer<typeof muniSchema>
export const searchMunicipalities = (q: string, uf?: string) => rpc('admin_municipality_search', { _q: q, _uf: uf || null, _limit: 12 }, z.array(muniSchema))

export const saveRegion = (id: string | null, name: string, center: number, radiusKm: number, notes = '') =>
  rpc('admin_save_region', { _id: id, _name: name, _center: center, _radius_km: radiusKm, _notes: notes || null }, z.string())
export const setRegionStatus = (id: string, status: RegionStatus, reason = '') =>
  rpc('admin_set_region_status', { _id: id, _status: status, _reason: reason || null }, z.any()).then(() => undefined)
export const setRegionMember = (region: string, ibge: number, include: boolean) =>
  rpc('admin_region_member', { _region: region, _ibge: ibge, _include: include }, z.any()).then(() => undefined)

const suggestionSchema = z.object({ seq: n, center_ibge: n, center_name: z.string(), uf: z.string(), newly_covered: n, region_id: z.string().nullable() })
export type Suggestion = z.infer<typeof suggestionSchema>
export const suggestRegions = (radiusKm: number, max: number, uf: string, create: boolean) =>
  rpc('admin_suggest_regions', { _radius_km: radiusKm, _max: max, _uf: uf || null, _create: create }, z.array(suggestionSchema))

/** Regiões ativas para o anunciante escolher. */
const activeSchema = z.object({ id: z.string(), name: z.string(), uf: z.string(), center_name: z.string().nullable(), radius_km: n.nullable(), municipalities: n })
export type ActiveRegion = z.infer<typeof activeSchema>
export const listActiveRegions = (q: string) => rpc('active_regions', { _q: q || null, _uf: null, _limit: 30 }, z.array(activeSchema))
