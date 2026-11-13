import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MlMap, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// o worker do mapa é servido pelo próprio site (CSP sem blob:)
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useRef } from 'react'
import type { LngLat } from '../../features/rastreamento/geo.ts'

maplibregl.setWorkerUrl(workerUrl)

/** Estilo do mapa: OpenFreeMap (gratuito, sem chave, dados do OpenStreetMap). Trocável por VITE_MAP_STYLE_URL. */
export const MAP_STYLE_URL = (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) || 'https://tiles.openfreemap.org/styles/positron'

export interface DeliveryMapProps {
  business: LngLat | null
  destination: LngLat | null
  /** última posição REAL recebida do entregador */
  position: LngLat | null
  heading?: number | null
  route: LngLat[] | null
  stale?: boolean
  /** texto acessível que resume o mapa */
  label: string
}

const SVG_NS = 'http://www.w3.org/2000/svg'
/** Ícone de moto montado com DOM (sem HTML cru). */
function motoIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: '22', height: '22', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) svg.setAttribute(k, v)
  for (const [cx, cy] of [['5.5', '17'], ['18.5', '17']]) {
    const c = document.createElementNS(SVG_NS, 'circle')
    c.setAttribute('cx', cx!); c.setAttribute('cy', cy!); c.setAttribute('r', '3')
    svg.appendChild(c)
  }
  for (const d of ['M15 6h2l3 8', 'M5.5 17 9 10h6l3.5 7', 'M9 10 7 6H4']) {
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', d)
    svg.appendChild(path)
  }
  return svg
}

function el(className: string, content: string | SVGSVGElement, title: string): HTMLDivElement {
  const d = document.createElement('div')
  d.className = className
  if (typeof content === 'string') {
    const span = document.createElement('span')
    span.textContent = content
    d.appendChild(span)
  } else d.appendChild(content)
  d.title = title
  d.setAttribute('aria-hidden', 'true')
  return d
}

/** Move o marcador entre duas posições REAIS (transição curta). Não prevê nem continua andando sozinho. */
function glide(marker: Marker, to: LngLat, ms = 1200) {
  const from = marker.getLngLat()
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (reduce || (from.lng === 0 && from.lat === 0)) { marker.setLngLat(to); return () => undefined }
  const start = performance.now()
  let raf = 0
  const step = (t: number) => {
    const k = Math.min(1, (t - start) / ms)
    const e = 1 - (1 - k) ** 3
    marker.setLngLat([from.lng + (to[0] - from.lng) * e, from.lat + (to[1] - from.lat) * e])
    if (k < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
  return () => cancelAnimationFrame(raf)
}

function applyRoute(m: MlMap, route: LngLat[] | null) {
  const src = m.getSource('rota') as GeoJSONSource | undefined
  src?.setData(route && route.length > 1 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route } } : { type: 'FeatureCollection', features: [] })
}

export default function DeliveryMap({ business, destination, position, heading, route, stale, label }: DeliveryMapProps) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<MlMap | null>(null)
  const moto = useRef<Marker | null>(null)
  const fixed = useRef<Marker[]>([])
  const fitted = useRef(false)
  const routeRef = useRef<LngLat[] | null>(route)
  routeRef.current = route

  useEffect(() => {
    if (!box.current) return
    const m = new maplibregl.Map({
      container: box.current,
      style: MAP_STYLE_URL,
      center: position ?? business ?? destination ?? [-44.57, -20.07],
      zoom: 14,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    m.on('load', () => {
      m.addSource('rota', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'rota-borda', type: 'line', source: 'rota', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 8 } })
      m.addLayer({ id: 'rota', type: 'line', source: 'rota', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FF5500', 'line-width': 4.5 } })
      applyRoute(m, routeRef.current)
    })
    map.current = m
    return () => { m.remove(); map.current = null; moto.current = null; fixed.current = []; fitted.current = false }
    // o mapa é criado uma vez; as atualizações vêm pelos efeitos abaixo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // loja e destino
  useEffect(() => {
    const m = map.current
    if (!m) return
    fixed.current.forEach((x) => x.remove())
    fixed.current = []
    if (business) fixed.current.push(new maplibregl.Marker({ element: el('tucai-pin tucai-pin-loja', 'Loja', 'Estabelecimento') }).setLngLat(business).addTo(m))
    if (destination) fixed.current.push(new maplibregl.Marker({ element: el('tucai-pin tucai-pin-destino', 'Entrega', 'Destino') }).setLngLat(destination).addTo(m))
  }, [business?.[0], business?.[1], destination?.[0], destination?.[1]]) // eslint-disable-line react-hooks/exhaustive-deps

  // rota
  useEffect(() => {
    const m = map.current
    if (!m) return
    // antes do 'load' a rota é aplicada pelo próprio carregamento (routeRef)
    if (m.getSource('rota')) applyRoute(m, route)
  }, [route])

  // motinha: só se mexe quando chega posição real nova
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (!position) { moto.current?.remove(); moto.current = null; return }
    if (!moto.current) {
      moto.current = new maplibregl.Marker({ element: el('tucai-moto', motoIcon(), 'Entregador'), rotationAlignment: 'map' }).setLngLat(position).addTo(m)
      return
    }
    return glide(moto.current, position)
  }, [position?.[0], position?.[1]]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    moto.current?.getElement().classList.toggle('tucai-moto-parada', !!stale)
    if (moto.current && typeof heading === 'number') moto.current.setRotation(0)
  }, [stale, heading])

  // enquadra loja, destino e entregador uma vez (depois a pessoa controla o zoom)
  useEffect(() => {
    const m = map.current
    if (!m || fitted.current) return
    const pts = [business, destination, position].filter(Boolean) as LngLat[]
    if (pts.length === 0) return
    fitted.current = true
    if (pts.length === 1) { m.jumpTo({ center: pts[0], zoom: 15 }); return }
    const b = new maplibregl.LngLatBounds(pts[0], pts[0])
    pts.forEach((p) => b.extend(p))
    m.fitBounds(b, { padding: 56, maxZoom: 16, duration: 0 })
  }, [business, destination, position])

  return <div ref={box} role="img" aria-label={label} className="tucai-map h-72 w-full overflow-hidden rounded-card border border-line sm:h-96" />
}
