import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { CART_KEY, MAX_QTY, addToCart, cartCount, cartSubtotal, clearCart, readCart, setLineQuantity, useCart } from './cartStore'

const bizA = { id: 'a', slug: 'loja-a', name: 'Loja A' }
const bizB = { id: 'b', slug: 'loja-b', name: 'Loja B' }
const burger = { productId: 'p1', name: 'X-Burger', unitCents: 3500, quantity: 1, optionIds: ['o2', 'o1'], optionLabels: ['Bacon', 'Ao ponto'], notes: '' }

describe('sacola', () => {
  beforeEach(() => clearCart())

  it('junta o mesmo produto com as mesmas escolhas (em qualquer ordem) numa linha', () => {
    addToCart(bizA, burger)
    addToCart(bizA, { ...burger, optionIds: ['o1', 'o2'], quantity: 2 })
    const c = readCart()!
    expect(c.lines).toHaveLength(1)
    expect(cartCount(c)).toBe(3)
    expect(cartSubtotal(c)).toBe(10500)
  })

  it('observação diferente vira outra linha', () => {
    addToCart(bizA, burger)
    addToCart(bizA, { ...burger, notes: 'sem cebola' })
    expect(readCart()!.lines).toHaveLength(2)
  })

  it('uma loja por vez: pergunta antes de trocar e só troca com confirmação', () => {
    addToCart(bizA, burger)
    expect(addToCart(bizB, burger)).toBe('other_business')
    expect(readCart()!.business.id).toBe('a')
    expect(addToCart(bizB, burger, true)).toBe('added')
    expect(readCart()!.business.id).toBe('b')
    expect(readCart()!.lines).toHaveLength(1)
  })

  it('limita a quantidade e remove a linha ao zerar', () => {
    addToCart(bizA, burger)
    const key = readCart()!.lines[0]!.key
    setLineQuantity(key, 999)
    expect(readCart()!.lines[0]!.quantity).toBe(MAX_QTY)
    setLineQuantity(key, 0)
    expect(readCart()).toBeNull()
    expect(window.localStorage.getItem(CART_KEY)).toBeNull()
  })

  it('descarta dado adulterado no armazenamento', () => {
    window.localStorage.setItem(CART_KEY, JSON.stringify({ business: bizA, lines: [{ ...burger, key: 'x', unitCents: -1 }] }))
    expect(readCart()).toBeNull()
  })

  it('o hook acompanha as mudanças', () => {
    const { result } = renderHook(() => useCart())
    expect(result.current).toBeNull()
    act(() => void addToCart(bizA, burger))
    expect(cartCount(result.current)).toBe(1)
  })
})
