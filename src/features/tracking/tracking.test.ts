import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readTrackingConfig, validGa4, validPixel } from './config'
import { CONSENT_KEY, CONSENT_VERSION, readConsent, saveConsent } from './consentStore'
import { __resetTracking, applyConsent, trackAddToCart, trackPageView, trackPurchase, trackSearch, trackSignUp } from './tracker'

const cfg = { ga4: 'G-TESTE123', pixel: '123456789012' }
const scripts = () => [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))
const gaCalls = () => (window.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>))
const fbCalls = () => (window.fbq?.queue ?? []) as unknown[][]

beforeEach(() => {
  __resetTracking()
  document.head.innerHTML = ''
  window.localStorage.clear()
  delete window.dataLayer
  delete window.gtag
  delete window.fbq
  delete window._fbq
})
afterEach(() => __resetTracking())

describe('configuração e consentimento', () => {
  it('IDs só com formato válido, lidos das metatags do Worker', () => {
    expect(validGa4(' g-abc123 ')).toBe('G-ABC123')
    expect(validGa4('UA-123')).toBeNull()
    expect(validPixel('12345678901')).toBe('12345678901')
    expect(validPixel('abc')).toBeNull()
    document.head.innerHTML = '<meta name="tucai:ga4-id" content="G-ABC123"><meta name="tucai:meta-pixel-id" content="x">'
    expect(readTrackingConfig()).toEqual({ ga4: 'G-ABC123', pixel: null })
  })
  it('registra escolha com data e versão; versão antiga pede nova escolha', () => {
    expect(readConsent()).toBeNull()
    const c = saveConsent({ analytics: true, marketing: false })
    expect(c.version).toBe(CONSENT_VERSION)
    expect(readConsent()).toMatchObject({ analytics: true, marketing: false })
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ ...c, version: '2000-01-01' }))
    expect(readConsent()).toBeNull()
  })
})

describe('carregamento só após consentimento', () => {
  it('sem escolha ou recusando: nenhum script de terceiros e nenhum evento', () => {
    applyConsent(cfg, null)
    applyConsent(cfg, { analytics: false, marketing: false, decidedAt: '', version: CONSENT_VERSION })
    trackPageView('/', 'Início')
    trackSearch('pizza')
    expect(scripts()).toEqual([])
    expect(window.dataLayer).toBeUndefined()
    expect(window.fbq).toBeUndefined()
  })
  it('aceitando só estatísticas carrega só o GA4 (Consent Mode com anúncios negados), uma vez', () => {
    const c = { analytics: true, marketing: false, decidedAt: '', version: CONSENT_VERSION }
    applyConsent(cfg, c)
    applyConsent(cfg, c)
    expect(scripts()).toEqual(['https://www.googletagmanager.com/gtag/js?id=G-TESTE123'])
    expect(gaCalls()[0]).toEqual(['consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }])
    expect(gaCalls().find((a) => a[0] === 'config')).toEqual(['config', 'G-TESTE123', { send_page_view: false }])
    expect(window.fbq).toBeUndefined()
  })
  it('revogar interrompe o envio', () => {
    applyConsent(cfg, { analytics: true, marketing: true, decidedAt: '', version: CONSENT_VERSION })
    applyConsent(cfg, { analytics: false, marketing: false, decidedAt: '', version: CONSENT_VERSION })
    const before = gaCalls().length
    trackSearch('pizza')
    expect(gaCalls().length).toBe(before + 0)
    expect(gaCalls().at(-1)).toEqual(['consent', 'update', { analytics_storage: 'denied' }])
    expect(fbCalls().at(-1)).toEqual(['consent', 'revoke'])
  })
})

describe('eventos', () => {
  beforeEach(() => applyConsent(cfg, { analytics: true, marketing: true, decidedAt: '', version: CONSENT_VERSION }))
  const events = (name: string) => gaCalls().filter((a) => a[0] === 'event' && a[1] === name)

  it('page_view uma vez por rota, mesmo com re-render', () => {
    trackPageView('/lojas', 'Lojas')
    trackPageView('/lojas', 'Lojas')
    trackPageView('/servicos', 'Serviços')
    expect(events('page_view')).toHaveLength(2)
    expect(fbCalls().filter((a) => a[0] === 'track' && a[1] === 'PageView')).toHaveLength(2)
  })
  it('valores em reais, mesmo event_id no GA4 e no Pixel, sem dados pessoais', () => {
    trackAddToCart({ id: 'p1', name: 'X-Burger', priceCents: 3500, quantity: 2, affiliation: 'Lanche Bom' })
    const ga = events('add_to_cart')[0]![2] as Record<string, unknown>
    expect(ga).toMatchObject({ currency: 'BRL', value: 70, items: [{ item_id: 'p1', price: 35, quantity: 2 }] })
    const fb = fbCalls().find((a) => a[1] === 'AddToCart')!
    expect(fb[3]).toEqual({ eventID: ga.event_id })
    expect(JSON.stringify([gaCalls(), fbCalls()])).not.toMatch(/@|telefone|phone|email|endereço|address/i)
  })
  it('compra contada uma única vez por pedido, com event_id estável para a Conversions API', () => {
    const order = { id: 'o1', code: 'AB12CD', totalCents: 7400, deliveryFeeCents: 400, items: [{ id: 'p1', name: 'X', priceCents: 3500, quantity: 2 }] }
    expect(trackPurchase(order)).toBe(true)
    expect(trackPurchase(order)).toBe(false)
    expect(events('purchase')).toHaveLength(1)
    expect(events('purchase')[0]![2]).toMatchObject({ transaction_id: 'AB12CD', value: 74, shipping: 4, event_id: 'purchase-o1' })
    expect(fbCalls().find((a) => a[1] === 'Purchase')![3]).toEqual({ eventID: 'purchase-o1' })
  })
  it('cadastro vira sign_up e CompleteRegistration', () => {
    trackSignUp('email')
    expect(events('sign_up')[0]![2]).toMatchObject({ method: 'email' })
    expect(fbCalls().some((a) => a[1] === 'CompleteRegistration')).toBe(true)
  })
})
