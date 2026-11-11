import { describe, expect, it } from 'vitest'
import { buildMenu } from './repository'
import { phoneDigits, whatsappHref } from '../../pages/BusinessPage.tsx'

describe('cardápio público', () => {
  it('agrupa por categoria em ordem, com adicionais, e omite categorias vazias', () => {
    const menu = buildMenu(
      [{ id: 'c2', name: 'Bebidas', sort_order: 20 }, { id: 'c1', name: 'Lanches', sort_order: 10 }, { id: 'c3', name: 'Vazia', sort_order: 30 }],
      [
        { id: 'p2', category_id: 'c1', name: 'X-Salada', description: null, price_cents: 2600, image_url: null, is_available: false, sort_order: 2 },
        { id: 'p1', category_id: 'c1', name: 'X-Burger', description: null, price_cents: 2400, image_url: null, is_available: true, sort_order: 1 },
        { id: 'p3', category_id: 'c2', name: 'Suco', description: null, price_cents: 800, image_url: null, is_available: true, sort_order: 1 },
      ],
      [{ id: 'g1', product_id: 'p1', name: 'Adicionais', min_select: 0, max_select: 2, sort_order: 0 }],
      [{ id: 'o1', group_id: 'g1', name: 'Bacon', price_delta_cents: 400, is_available: true, sort_order: 0 }],
    )
    expect(menu.map((s) => s.name)).toEqual(['Lanches', 'Bebidas'])
    expect(menu[0]!.products.map((p) => p.name)).toEqual(['X-Burger', 'X-Salada'])
    expect(menu[0]!.products[0]!.groups[0]!.options[0]).toMatchObject({ name: 'Bacon', priceDeltaCents: 400 })
    expect(menu[0]!.products[1]!.isAvailable).toBe(false)
  })
  it('links de contato só com dígitos', () => {
    expect(phoneDigits('(35) 3000-0000')).toBe('3530000000')
    expect(phoneDigits('abc')).toBeNull()
    expect(whatsappHref('(35) 99999-0000')).toBe('https://wa.me/5535999990000')
    expect(whatsappHref('javascript:alert(1)')).toBeNull()
  })
})
