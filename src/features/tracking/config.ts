/**
 * IDs públicos de medição. Ficam nas variáveis do Worker (wrangler.jsonc → GA4_ID e META_PIXEL_ID),
 * que os escreve no HTML como <meta name="tucai:ga4-id"> e <meta name="tucai:meta-pixel-id">.
 * Assim cada ambiente tem os seus IDs, sem rebuild, e nada carrega quando estão vazios.
 */
export interface TrackingConfig {
  ga4: string | null
  pixel: string | null
}

export const GA4_RE = /^G-[A-Z0-9]{4,16}$/
export const PIXEL_RE = /^\d{8,20}$/

export function validGa4(id: string | null | undefined): string | null {
  const v = (id ?? '').trim().toUpperCase()
  return GA4_RE.test(v) ? v : null
}

export function validPixel(id: string | null | undefined): string | null {
  const v = (id ?? '').trim()
  return PIXEL_RE.test(v) ? v : null
}

export function readTrackingConfig(doc: Document = document): TrackingConfig {
  const meta = (name: string) => doc.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content
  return { ga4: validGa4(meta('tucai:ga4-id')), pixel: validPixel(meta('tucai:meta-pixel-id')) }
}

export const trackingConfigured = (c: TrackingConfig) => Boolean(c.ga4 || c.pixel)
