import { describe, expect, it } from 'vitest'
import { parseCoordinate } from './AdminCities.tsx'

describe('parseCoordinate', () => {
  it('aceita ponto ou vírgula; vazio é null; texto é inválido', () => {
    expect(parseCoordinate('-20,7389')).toBe(-20.7389)
    expect(parseCoordinate(' -46.75 ')).toBe(-46.75)
    expect(parseCoordinate('')).toBeNull()
    expect(Number.isNaN(parseCoordinate('abc'))).toBe(true)
    expect(Number.isNaN(parseCoordinate('1e5'))).toBe(true)
  })
})
