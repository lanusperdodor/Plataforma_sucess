import { describe, expect, it } from 'vitest'
import { contrastRatio } from './color'

describe('contrastRatio', () => {
  it('preto sobre branco é 21', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
  })
  it('cores iguais dão 1 e é simétrico', () => {
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5)
    expect(contrastRatio('#777', '#fff')).toBeCloseTo(contrastRatio('#fff', '#777'), 10)
  })
  it('#767676 sobre branco ≈ 4,54', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 1)
  })
  it('rejeita hex inválido', () => {
    expect(() => contrastRatio('red', '#fff')).toThrow()
  })
})
