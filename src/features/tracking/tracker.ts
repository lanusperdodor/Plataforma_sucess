/**
 * GA4 e Meta Pixel carregados SÓ depois do consentimento (nada é baixado antes).
 *  * Sem scripts inline (CSP): os "stubs" oficiais do gtag e do fbq são criados aqui.
 *  * Google Consent Mode v2: análise conforme a escolha; sinais de anúncio do Google sempre negados
 *    (a Tucaí não usa Google Ads).
 *  * Cada evento leva event_id/eventID: base para deduplicar com a futura Conversions API.
 *  * Nenhum dado pessoal: sem nome, e-mail, telefone ou endereço. Valores em reais (BRL).
 *  * Compra só quando o pedido é concluído (entregue/retirado), uma vez por pedido.
 */
import { z } from 'zod'
import { readStorage, writeStorage } from '../../lib/storage'
import type { Consent } from './consentStore'
import type { TrackingConfig } from './config'

type Fn = (...args: unknown[]) => void
interface FbqStub extends Fn {
  callMethod?: Fn
  queue: unknown[]
  push: FbqStub
  loaded: boolean
  version: string
}
declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: Fn
    fbq?: FbqStub
    _fbq?: FbqStub
  }
}

export const TRACKED_PURCHASES_KEY = 'tracked:purchases'

const state = { ga: false, gaLoaded: false, pixel: false, pixelLoaded: false, lastPage: '' }

function addScript(src: string) {
  if (document.querySelector(`script[src="${src}"]`)) return // nunca duplica
  const s = document.createElement('script')
  s.async = true
  s.src = src
  document.head.appendChild(s)
}

function startGa(id: string) {
  window.dataLayer = window.dataLayer || []
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params -- o gtag exige o objeto arguments
    window.dataLayer!.push(arguments)
  }
  window.gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' })
  window.gtag('js', new Date())
  window.gtag('config', id, { send_page_view: false }) // page_view enviado pelo app, uma vez por rota
  addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`)
  state.gaLoaded = true
}

function startPixel(id: string) {
  if (!window.fbq) {
    const n = function fbq(...args: unknown[]) {
      if (n.callMethod) n.callMethod(...args)
      else n.queue.push(args)
    } as FbqStub
    n.queue = []
    n.push = n
    n.loaded = true
    n.version = '2.0'
    window.fbq = n
    window._fbq = window._fbq ?? n
  }
  addScript('https://connect.facebook.net/en_US/fbevents.js')
  window.fbq('init', id)
  state.pixelLoaded = true
}

/** Liga, desliga ou mantém as ferramentas conforme a escolha atual. */
export function applyConsent(config: TrackingConfig, consent: Consent | null): void {
  const wantGa = Boolean(config.ga4 && consent?.analytics)
  const wantPixel = Boolean(config.pixel && consent?.marketing)
  if (wantGa && !state.gaLoaded) startGa(config.ga4!)
  else if (state.gaLoaded) window.gtag?.('consent', 'update', { analytics_storage: wantGa ? 'granted' : 'denied' })
  if (wantPixel && !state.pixelLoaded) startPixel(config.pixel!)
  else if (state.pixelLoaded) window.fbq?.('consent', wantPixel ? 'grant' : 'revoke')
  state.ga = wantGa
  state.pixel = wantPixel
}

export const trackingActive = () => state.ga || state.pixel

const newEventId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)
const brl = (cents: number) => Math.round(cents) / 100

export interface TrackItem {
  id: string
  name: string
  priceCents?: number
  quantity?: number
  category?: string
  /** Estabelecimento que vende o item. */
  affiliation?: string
}

const gaItems = (items: TrackItem[]) =>
  items.map((i, index) => ({
    item_id: i.id,
    item_name: i.name,
    ...(i.priceCents !== undefined ? { price: brl(i.priceCents) } : {}),
    ...(i.quantity !== undefined ? { quantity: i.quantity } : {}),
    ...(i.category ? { item_category: i.category } : {}),
    ...(i.affiliation ? { affiliation: i.affiliation } : {}),
    index,
  }))

function send(ga: { name: string; params: Record<string, unknown> } | null, pixel: { name: string; params: Record<string, unknown> } | null, eventId = newEventId()): string {
  if (state.ga && ga) window.gtag?.('event', ga.name, { ...ga.params, event_id: eventId })
  if (state.pixel && pixel) window.fbq?.('track', pixel.name, pixel.params, { eventID: eventId })
  return eventId
}

/** Uma visualização por rota (StrictMode, re-render e consultas não duplicam). */
export function trackPageView(path: string, title: string): void {
  if (!trackingActive() || state.lastPage === path) return
  state.lastPage = path
  send({ name: 'page_view', params: { page_location: window.location.origin + path, page_title: title } }, { name: 'PageView', params: {} })
}

export function trackViewItemList(listId: string, listName: string, items: TrackItem[]): void {
  if (items.length === 0) return
  send({ name: 'view_item_list', params: { item_list_id: listId, item_list_name: listName, items: gaItems(items) } }, null)
}

export function trackSelectItem(listName: string, item: TrackItem): void {
  send({ name: 'select_item', params: { item_list_name: listName, items: gaItems([item]) } }, null)
}

export function trackViewItem(item: TrackItem): void {
  send(
    { name: 'view_item', params: { currency: 'BRL', ...(item.priceCents !== undefined ? { value: brl(item.priceCents) } : {}), items: gaItems([item]) } },
    { name: 'ViewContent', params: { content_ids: [item.id], content_name: item.name, content_type: 'product_group', ...(item.category ? { content_category: item.category } : {}) } },
  )
}

export function trackAddToCart(item: TrackItem & { priceCents: number; quantity: number }): void {
  const value = brl(item.priceCents * item.quantity)
  send(
    { name: 'add_to_cart', params: { currency: 'BRL', value, items: gaItems([item]) } },
    { name: 'AddToCart', params: { currency: 'BRL', value, content_ids: [item.id], content_name: item.name, content_type: 'product', contents: [{ id: item.id, quantity: item.quantity }] } },
  )
}

export function trackBeginCheckout(items: (TrackItem & { priceCents: number; quantity: number })[], subtotalCents: number): void {
  send(
    { name: 'begin_checkout', params: { currency: 'BRL', value: brl(subtotalCents), items: gaItems(items) } },
    { name: 'InitiateCheckout', params: { currency: 'BRL', value: brl(subtotalCents), num_items: items.reduce((s, i) => s + i.quantity, 0), content_ids: items.map((i) => i.id), content_type: 'product' } },
  )
}

/**
 * Compra concluída (pedido entregue ou retirado). Uma vez por pedido neste aparelho; o event_id
 * é estável ("purchase-<id>") para a Conversions API deduplicar o mesmo pedido no futuro.
 */
export function trackPurchase(order: { id: string; code: string; totalCents: number; deliveryFeeCents: number; affiliation?: string; items: (TrackItem & { priceCents: number; quantity: number })[] }): boolean {
  if (!trackingActive()) return false
  const done = readStorage(TRACKED_PURCHASES_KEY, z.array(z.string())) ?? []
  if (done.includes(order.id)) return false
  send(
    {
      name: 'purchase',
      params: { transaction_id: order.code, currency: 'BRL', value: brl(order.totalCents), shipping: brl(order.deliveryFeeCents), ...(order.affiliation ? { affiliation: order.affiliation } : {}), items: gaItems(order.items) },
    },
    { name: 'Purchase', params: { currency: 'BRL', value: brl(order.totalCents), content_ids: order.items.map((i) => i.id), content_type: 'product', num_items: order.items.reduce((s, i) => s + i.quantity, 0) } },
    `purchase-${order.id}`,
  )
  writeStorage(TRACKED_PURCHASES_KEY, [order.id, ...done].slice(0, 100))
  return true
}

export function trackSearch(term: string): void {
  const t = term.trim().slice(0, 100)
  if (!t) return
  send({ name: 'search', params: { search_term: t } }, { name: 'Search', params: { search_string: t } })
}

export function trackSignUp(method: 'email' | 'google'): void {
  send({ name: 'sign_up', params: { method } }, { name: 'CompleteRegistration', params: { status: true } })
}

export function trackLogin(method: 'email' | 'username' | 'google'): void {
  send({ name: 'login', params: { method } }, null)
}

/** Só para testes. */
export function __resetTracking(): void {
  Object.assign(state, { ga: false, gaLoaded: false, pixel: false, pixelLoaded: false, lastPage: '' })
}
