import { describe, expect, it } from 'vitest'
import { estimate, formatDistance, freshness, googleMapsRoute, haversine, routeProgress, shouldSend, type LngLat } from './geo'

// rota reta para o norte, ~1,11 km (0,01° de latitude)
const route: LngLat[] = [[-44.57, -20.08], [-44.57, -20.075], [-44.57, -20.07]]

describe('geometria do rastreamento', () => {
  it('haversine: 0,01° de latitude ≈ 1112 m', () => {
    expect(haversine([-44.57, -20.08], [-44.57, -20.07])).toBeCloseTo(1112, -1)
  })

  it('distância restante ao longo da rota e afastamento', () => {
    const p = routeProgress([-44.57, -20.075], route)!
    expect(p.remainingM).toBeCloseTo(556, -1)
    expect(p.offRouteM).toBeLessThan(1)
    const off = routeProgress([-44.567, -20.075], route)!
    expect(off.offRouteM).toBeCloseTo(313, -1)
  })

  it('situação da posição: ao vivo, atrasada, desatualizada', () => {
    const now = Date.parse('2026-11-13T12:00:00Z')
    expect(freshness('2026-11-13T11:59:30Z', now)).toBe('ao_vivo')
    expect(freshness('2026-11-13T11:58:30Z', now)).toBe('atrasada')
    expect(freshness('2026-11-13T11:57:00Z', now)).toBe('desatualizada')
  })

  it('previsão só com rota, posição recente e perto da rota', () => {
    const now = Date.parse('2026-11-13T12:00:00Z')
    const r = { geometry: route, distance_m: 1112, duration_s: 222 } // ~5 m/s
    expect(estimate([-44.57, -20.075], '2026-11-13T11:59:50Z', r, now)).toEqual({ remainingM: expect.closeTo(556, -1), etaMin: 2 })
    expect(estimate([-44.57, -20.075], '2026-11-13T11:50:00Z', r, now)).toBeNull() // posição velha
    expect(estimate([-44.56, -20.075], '2026-11-13T11:59:50Z', r, now)).toBeNull() // longe da rota
    expect(estimate([-44.57, -20.075], '2026-11-13T11:59:50Z', null, now)).toBeNull() // sem rota
  })

  it('formata distância', () => {
    expect(formatDistance(4)).toBe('10 m')
    expect(formatDistance(556)).toBe('560 m')
    expect(formatDistance(1543)).toBe('1,5 km')
  })

  it('link do Google Maps é de rota (dir), por coordenada ou endereço', () => {
    expect(googleMapsRoute({ lat: -20.08, lng: -44.58 })).toBe('https://www.google.com/maps/dir/?api=1&destination=-20.08%2C-44.58&travelmode=driving')
    expect(googleMapsRoute(null, 'Rua A, 1')).toContain('destination=Rua%20A%2C%201')
    expect(googleMapsRoute(null, '  ')).toBeNull()
  })

  it('envio a cada ~20 s, ou antes se andou bastante', () => {
    const p: LngLat = [-44.57, -20.08]
    expect(shouldSend(null, 0, p)).toBe(true)
    expect(shouldSend({ at: 0, pos: p }, 10_000, p)).toBe(false)
    expect(shouldSend({ at: 0, pos: p }, 20_000, p)).toBe(true)
    expect(shouldSend({ at: 0, pos: p }, 9_000, [-44.57, -20.0790])).toBe(true) // ~111 m
    expect(shouldSend({ at: 0, pos: p }, 5_000, [-44.57, -20.0790])).toBe(false) // cedo demais
  })
})

import { nextStep, osmDirections, roughEtaMin } from './geo'
describe('navegação: próxima instrução e estimativas', () => {
  const steps = [
    { text: 'Siga pela Rua A', type: 'depart', distance_m: 200, at: null },
    { text: 'Vire à direita na Av. B', type: 'turn-right', distance_m: 500, at: null },
    { text: 'Vire à esquerda na Rua C', type: 'turn-left', distance_m: 300, at: null },
    { text: 'Você chegou', type: 'arrive', distance_m: 0, at: null },
  ]
  it('no início, a próxima manobra é a conversão para a Av. B daqui a 200 m', () => {
    expect(nextStep(steps, 1000, 1000)).toMatchObject({ step: { type: 'turn-right' }, inM: 200 })
  })
  it('no meio da Av. B, a próxima é a Rua C', () => {
    const r = nextStep(steps, 1000, 600)!
    expect(r.step.type).toBe('turn-left')
    expect(Math.round(r.inM)).toBe(300)
  })
  it('perto do fim, mostra a chegada', () => {
    expect(nextStep(steps, 1000, 100)).toMatchObject({ step: { type: 'arrive' } })
    expect(nextStep([], 1000, 100)).toBeNull()
  })
  it('estimativa sem rota e link alternativo gratuito', () => {
    expect(roughEtaMin(2500, 'moto')).toBe(6)
    expect(roughEtaMin(2500, 'bicicleta')).toBe(12)
    expect(osmDirections({ lat: -20.07, lng: -44.57 }, { lat: -20.08, lng: -44.58 })).toContain('openstreetmap.org/directions?engine=fossgis_osrm_car&route=-20.07000%2C-44.57000%3B-20.08000%2C-44.58000')
    expect(osmDirections(null, null)).toBeNull()
  })
})
