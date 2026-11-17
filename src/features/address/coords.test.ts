import { describe, expect, it } from 'vitest'
import { parseCoordinates } from './coords'

describe('coordenadas coladas', () => {
  it('aceita os formatos comuns', () => {
    expect(parseCoordinates('-20.737123, -46.752456')).toEqual({ lat: -20.737123, lng: -46.752456 })
    expect(parseCoordinates('-20,7371 -46,7524')).toEqual({ lat: -20.7371, lng: -46.7524 })
    expect(parseCoordinates('-20,7371; -46,7524')).toEqual({ lat: -20.7371, lng: -46.7524 })
    expect(parseCoordinates('https://www.google.com/maps/place/Loja/@-20.7371,-46.7524,17z/data=x')).toEqual({ lat: -20.7371, lng: -46.7524 })
    expect(parseCoordinates('https://maps.google.com/?q=-20.7371,-46.7524')).toEqual({ lat: -20.7371, lng: -46.7524 })
    expect(parseCoordinates('https://www.openstreetmap.org/#map=18/-20.7371/-46.7524')).toEqual({ lat: -20.7371, lng: -46.7524 })
  })
  it('recusa fora do Brasil ou texto inválido', () => {
    expect(parseCoordinates('38.72, -9.14')).toBeNull()
    expect(parseCoordinates('Rua das Flores, 120')).toBeNull()
    expect(parseCoordinates('')).toBeNull()
  })
})
