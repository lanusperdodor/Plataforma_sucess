import * as maplibregl from 'maplibre-gl'
import type { Map as MlMap, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useRef } from 'react'
import type { LngLat } from '../../features/rastreamento/geo.ts'
import { MAP_STYLE_URL } from './DeliveryMap.tsx'

maplibregl.setWorkerUrl(workerUrl)

/** Mapa para marcar um ponto: toque no mapa ou arraste o alfinete. */
export default function LocationPickerMap({ value, onChange, label }: { value: LngLat | null; onChange: (p: LngLat) => void; label: string }) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<MlMap | null>(null)
  const pin = useRef<Marker | null>(null)
  const cb = useRef(onChange)
  cb.current = onChange

  useEffect(() => {
    if (!box.current) return
    const m = new maplibregl.Map({ container: box.current, style: MAP_STYLE_URL, center: value ?? [-44.57, -20.07], zoom: value ? 16 : 13, attributionControl: { compact: true }, cooperativeGestures: true })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    m.on('click', (e) => cb.current([Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))]))
    map.current = m
    return () => { m.remove(); map.current = null; pin.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m) return
    if (!value) { pin.current?.remove(); pin.current = null; return }
    if (!pin.current) {
      const p = new maplibregl.Marker({ color: '#FF5500', draggable: true }).setLngLat(value).addTo(m)
      p.on('dragend', () => { const l = p.getLngLat(); cb.current([Number(l.lng.toFixed(6)), Number(l.lat.toFixed(6))]) })
      pin.current = p
    } else pin.current.setLngLat(value)
    m.easeTo({ center: value, zoom: Math.max(m.getZoom(), 16) })
  }, [value?.[0], value?.[1]]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={box} role="img" aria-label={label} className="h-72 w-full overflow-hidden rounded-card border border-line sm:h-80" />
}
