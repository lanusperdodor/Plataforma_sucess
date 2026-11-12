import { z } from 'zod'
import { rpc } from '../../lib/rpc'

/** Publicações patrocinadas (0029). Preço, elegibilidade, pagamento e métricas são decididos no banco. */
export type AdObjective = 'alcance' | 'visitas' | 'pedidos' | 'mensagens'
export const OBJECTIVE_LABEL: Record<AdObjective, string> = {
  alcance: 'Mostrar para mais pessoas', visitas: 'Levar visitas à loja', pedidos: 'Gerar pedidos', mensagens: 'Receber mensagens',
}
export type AdStatus = 'aguardando_pagamento' | 'aguardando_aprovacao' | 'ativa' | 'pausada' | 'recusada' | 'encerrada' | 'cancelada'
export const AD_STATUS_LABEL: Record<AdStatus, string> = {
  aguardando_pagamento: 'Aguardando pagamento', aguardando_aprovacao: 'Em análise pela Tucaí', ativa: 'Ativa', pausada: 'Pausada',
  recusada: 'Recusada', encerrada: 'Encerrada', cancelada: 'Cancelada',
}

const n = z.number()
const quoteSchema = z.object({
  ok: z.boolean(), min_cents: n, total_cents: n, daily_cents: n.nullable(), min_days: n, max_days: n, max_regions: n, regions: n, valid_regions: n,
  min_total_cents: n, min_daily_cents_per_region: n,
})
export type AdQuote = z.infer<typeof quoteSchema>
export const getAdQuote = (regions: string[], days: number, totalCents: number) =>
  rpc('ad_quote', { _regions: regions, _days: days, _total_cents: totalCents }, quoteSchema)

export const createCampaign = (a: { businessId: string; postId: string; objective: AdObjective; regions: string[]; days: number; totalCents: number; opId: string }) =>
  rpc('merchant_create_campaign', { _business: a.businessId, _post: a.postId, _objective: a.objective, _regions: a.regions, _days: a.days, _total_cents: a.totalCents, _op: a.opId },
    z.object({ campaign_id: z.string(), charge_id: z.string(), amount_cents: n, repetida: z.boolean() }))
export const cancelCampaign = (id: string) => rpc('merchant_cancel_campaign', { _campaign: id }, z.any()).then(() => undefined)

const campaignSchema = z.object({
  id: z.string(), post_id: z.string().nullable(), post_excerpt: z.string().nullable(), objective: z.string(), status: z.string(), total_cents: n, days: n,
  daily_cents: n, regions: z.array(z.string()).nullable(), starts_at: z.string().nullable(), ends_at: z.string().nullable(), paid: z.boolean(),
  approved: z.boolean(), review_note: z.string().nullable(), charge_id: z.string().nullable(), charge_status: z.string().nullable(),
  impressions: n, clicks: n, created_at: z.string(),
})
export type Campaign = z.infer<typeof campaignSchema>
export const listCampaigns = (businessId: string) => rpc('merchant_campaigns', { _business: businessId }, z.array(campaignSchema))

const sponsoredSchema = z.object({ campaign_id: z.string(), post_id: z.string(), slot_every: n })
export type SponsoredSlot = z.infer<typeof sponsoredSchema>
export const getSponsoredFeed = (cityId: string) => rpc('sponsored_feed', { _city: cityId, _limit: 3 }, z.array(sponsoredSchema))
export const trackAd = (campaignId: string, kind: 'impressao' | 'clique') => rpc('ad_track', { _campaign: campaignId, _kind: kind }, z.boolean()).catch(() => false)

// ---------- Master ----------
const summarySchema = z.object({
  receita_cents: n, receita_mes_cents: n, ativas: n, aguardando_aprovacao: n, aguardando_pagamento: n, reembolso_pendente: n, impressoes: n, cliques: n,
  config: z.object({ min_total_cents: n, min_daily_cents_per_region: n, min_days: n, max_days: n, max_regions: n, feed_every: n, max_campaigns_per_viewer_day: n }),
})
export type AdsSummary = z.infer<typeof summarySchema>
export const getAdsSummary = () => rpc('admin_ads_summary', undefined, summarySchema)

const adminCampaignSchema = campaignSchema.omit({ post_id: true, charge_id: true, charge_status: true, daily_cents: true }).extend({
  business_id: z.string(), business_name: z.string(), is_test: z.boolean(), total_count: n,
})
export type AdminCampaign = z.infer<typeof adminCampaignSchema>
export const listAdminCampaigns = (f: { status?: string; q?: string; page: number; pageSize: number }) =>
  rpc('admin_ad_campaigns', { _status: f.status || null, _region: null, _q: f.q || null, _limit: f.pageSize, _offset: (f.page - 1) * f.pageSize }, z.array(adminCampaignSchema))
export const reviewCampaign = (id: string, approve: boolean, note: string) => rpc('admin_review_campaign', { _campaign: id, _approve: approve, _note: note || null }, z.string())
export const setCampaignStatus = (id: string, status: 'ativa' | 'pausada' | 'encerrada', reason: string) =>
  rpc('admin_set_campaign_status', { _campaign: id, _status: status, _reason: reason }, z.any()).then(() => undefined)
export const saveAdSettings = (c: AdsSummary['config']) =>
  rpc('admin_ad_settings_set', {
    _min_total_cents: c.min_total_cents, _min_daily_cents_per_region: c.min_daily_cents_per_region, _min_days: c.min_days, _max_days: c.max_days,
    _max_regions: c.max_regions, _feed_every: c.feed_every, _max_campaigns_per_viewer_day: c.max_campaigns_per_viewer_day,
  }, z.any()).then(() => undefined)
