import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MlMap, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// o worker do mapa é servido pelo próprio site (CSP sem blob:)
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useRef } from 'react'
import type { LngLat } from '../../features/rastreamento/geo.ts'

maplibregl.setWorkerUrl(workerUrl)

/**
 * Mapas gratuitos do OpenFreeMap (dados do OpenStreetMap, sem chave e sem cobrança). Escuro no tema escuro, claro e
 * limpo (sem áreas verdes chamativas) no tema claro. Trocável por VITE_MAP_STYLE_URL / VITE_MAP_STYLE_DARK_URL.
 */
const STYLE_LIGHT = (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) || 'https://tiles.openfreemap.org/styles/positron'
const STYLE_DARK = (import.meta.env.VITE_MAP_STYLE_DARK_URL as string | undefined) || 'https://tiles.openfreemap.org/styles/dark'

const SVG_NS = 'http://www.w3.org/2000/svg'
function svg(paths: { d?: string; circle?: [number, number, number] }[], size = 22): SVGSVGElement {
  const s = document.createElementNS(SVG_NS, 'svg')
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: String(size), height: String(size), fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) s.setAttribute(k, v)
  for (const p of paths) {
    if (p.circle) {
      const c = document.createElementNS(SVG_NS, 'circle')
      c.setAttribute('cx', String(p.circle[0])); c.setAttribute('cy', String(p.circle[1])); c.setAttribute('r', String(p.circle[2]))
      s.appendChild(c)
    } else if (p.d) {
      const e = document.createElementNS(SVG_NS, 'path')
      e.setAttribute('d', p.d)
      s.appendChild(e)
    }
  }
  return s
}
// ícones desenhados com DOM (sem HTML cru)
const ICONS: Record<string, () => SVGSVGElement> = {
  moto: () => svg([{ circle: [5.5, 17, 3] }, { circle: [18.5, 17, 3] }, { d: 'M15 6h2l3 8' }, { d: 'M5.5 17 9 10h6l3.5 7' }, { d: 'M9 10 7 6H4' }]),
  carro: () => svg([{ d: 'M5 17h14v-5l-2-5H7l-2 5z' }, { circle: [7.5, 17, 2] }, { circle: [16.5, 17, 2] }, { d: 'M5 12h14' }]),
  bicicleta: () => svg([{ circle: [5.5, 17, 3.5] }, { circle: [18.5, 17, 3.5] }, { d: 'M5.5 17 10 9h5l3.5 8' }, { d: 'M10 9 8.5 6H7' }, { d: 'M15 9l-3 8' }]),
  loja: () => svg([{ d: 'M7 3v8a2 2 0 0 0 4 0V3' }, { d: 'M9 3v18' }, { d: 'M17 3c-2 0-3 2-3 5s1 4 3 4v9' }], 20),
  destino: () => svg([{ d: 'M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z' }, { circle: [12, 9, 2.5] }], 20),
}

function pin(kind: 'loja' | 'destino', title: string): HTMLDivElement {
  const d = document.createElement('div')
  d.className = `tucai-nav-pin tucai-nav-pin-${kind}`
  d.title = title
  d.setAttribute('aria-hidden', 'true')
  d.appendChild(ICONS[kind]!())
  return d
}

function vehicleEl(vehicle: string): { root: HTMLDivElement; arrow: HTMLDivElement } {
  const root = document.createElement('div')
  root.className = 'tucai-nav-vehicle'
  root.setAttribute('aria-hidden', 'true')
  const arrow = document.createElement('div')
  arrow.className = 'tucai-nav-heading'
  root.appendChild(arrow)
  const icon = document.createElement('div')
  icon.className = 'tucai-nav-vehicle-icon'
  icon.appendChild((ICONS[vehicle] ?? ICONS.moto!)())
  root.appendChild(icon)
  return { root, arrow }
}

export interface NavigationMapProps {
  vehicle: string
  /** posição do aparelho (precisa, só o próprio entregador vê) */
  position: LngLat | null
  heading: number | null
  store: LngLat | null
  destination: LngLat | null
  route: LngLat[] | null
  /** seguir o entregador (desliga quando a pessoa arrasta o mapa) */
  follow: boolean
  onUserMove: () => void
  dark: boolean
  label: string
}

function setRoute(m: MlMap, route: LngLat[] | null) {
  const src = m.getSource('rota') as GeoJSONSource | undefined
  src?.setData(route && route.length > 1 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route } } : { type: 'FeatureCollection', features: [] })
}

export default function NavigationMap({ vehicle, position, heading, store, destination, route, follow, onUserMove, dark, label }: NavigationMapProps) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<MlMap | null>(null)
  const me = useRef<{ marker: Marker; arrow: HTMLDivElement } | null>(null)
  const pins = useRef<Marker[]>([])
  const routeRef = useRef(route)
  routeRef.current = route
  const moveCb = useRef(onUserMove)
  moveCb.current = onUserMove
  const fitted = useRef(false)

  useEffect(() => {
    if (!box.current) return
    const start = position ?? store ?? destination ?? [-44.57, -20.07]
    const m = new maplibregl.Map({ container: box.current, style: dark ? STYLE_DARK : STYLE_LIGHT, center: start, zoom: 15, attributionControl: { compact: true }, pitchWithRotate: false })
    let fellBack = false
    m.on('error', (e) => {
      // estilo escuro indisponível: usa o claro (o mapa nunca fica em branco por causa do estilo)
      if (!fellBack && dark && String((e as unknown as { error?: { message?: string } }).error?.message ?? '').match(/style|fetch|load/i)) { fellBack = true; m.setStyle(STYLE_LIGHT) }
    })
    const addRoute = () => {
      if (m.getSource('rota')) return
      m.addSource('rota', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'rota-borda', type: 'line', source: 'rota', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': dark ? '#0b0d10' : '#ffffff', 'line-width': 10 } })
      m.addLayer({ id: 'rota', type: 'line', source: 'rota', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FF5500', 'line-width': 6 } })
      setRoute(m, routeRef.current)
    }
    m.on('style.load', addRoute)
    m.on('dragstart', () => moveCb.current())
    map.current = m
    return () => { m.remove(); map.current = null; me.current = null; pins.current = []; fitted.current = false }
    // o mapa é criado uma vez por tema; as atualizações vêm dos efeitos abaixo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark])

  useEffect(() => { const m = map.current; if (m?.getSource('rota')) setRoute(m, route) }, [route])

  useEffect(() => {
    const m = map.current
    if (!m) return
    pins.current.forEach((p) => p.remove())
    pins.current = []
    if (store) pins.current.push(new maplibregl.Marker({ element: pin('loja', 'Coleta'), anchor: 'bottom' }).setLngLat(store).addTo(m))
    if (destination) pins.current.push(new maplibregl.Marker({ element: pin('destino', 'Entrega'), anchor: 'bottom' }).setLngLat(destination).addTo(m))
  }, [store?.[0], store?.[1], destination?.[0], destination?.[1], dark]) // eslint-disable-line react-hooks/exhaustive-deps

  // veículo: posição do próprio aparelho; seta indica a direção do movimento
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (!position) { me.current?.marker.remove(); me.current = null; return }
    if (!me.current) {
      const el = vehicleEl(vehicle)
      me.current = { marker: new maplibregl.Marker({ element: el.root }).setLngLat(position).addTo(m), arrow: el.arrow }
    } else me.current.marker.setLngLat(position)
    me.current.arrow.style.display = typeof heading === 'number' ? 'block' : 'none'
    if (typeof heading === 'number') me.current.arrow.style.transform = `rotate(${heading}deg)`
    if (follow) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      m.easeTo({ center: position, zoom: Math.max(m.getZoom(), 16), duration: reduce ? 0 : 800 })
    }
  }, [position?.[0], position?.[1], heading, follow, vehicle, dark]) // eslint-disable-line react-hooks/exhaustive-deps

  // primeira vez: enquadra veículo, coleta e entrega
  useEffect(() => {
    const m = map.current
    if (!m || fitted.current || follow) return
    const pts = [position, store, destination].filter(Boolean) as LngLat[]
    if (pts.length < 2) return
    fitted.current = true
    const b = new maplibregl.LngLatBounds(pts[0], pts[0])
    pts.forEach((p) => b.extend(p))
    m.fitBounds(b, { padding: 64, maxZoom: 16, duration: 0 })
  }, [position, store, destination, follow])

  return <div ref={box} role="img" aria-label={label} className="tucai-map h-full w-full" />
}
