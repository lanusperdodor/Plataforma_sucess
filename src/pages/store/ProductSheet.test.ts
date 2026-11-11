import { describe, expect, it } from 'vitest'
import { groupErrors, unitPrice } from './ProductSheet'

const product = {
  id: 'p', name: 'X', description: null, priceCents: 3000, imageUrl: null, isAvailable: true,
  groups: [
    { id: 'g1', name: 'Ponto', minSelect: 1, maxSelect: 1, options: [{ id: 'a', name: 'Ao ponto', priceDeltaCents: 0, isAvailable: true }] },
    { id: 'g2', name: 'Extras', minSelect: 0, maxSelect: 2, options: [{ id: 'b', name: 'Bacon', priceDeltaCents: 500, isAvailable: true }, { id: 'c', name: 'Ovo', priceDeltaCents: 200, isAvailable: true }] },
  ],
}

describe('modal de produto', () => {
  it('exige os grupos obrigatórios', () => {
    expect(groupErrors(product.groups, {})).toHaveProperty('g1')
    expect(groupErrors(product.groups, { g1: ['a'] })).toEqual({})
  })
  it('soma os adicionais ao preço unitário', () => {
    expect(unitPrice(product, { g1: ['a'], g2: ['b', 'c'] })).toBe(3700)
  })
})
