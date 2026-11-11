import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FakeSupabase } from '../../test/fakeSupabase'

const h = vi.hoisted(() => ({ fake: null as unknown as FakeSupabase }))
vi.mock('../../lib/supabase', async () => {
  const { createFakeSupabase } = await import('../../test/fakeSupabase')
  h.fake = createFakeSupabase()
  return { isSupabaseConfigured: true, supabase: h.fake.supabase }
})
const repo = await import('./repository')
afterEach(() => h.fake.reset())

const cart = {
  business: { id: 'b1', slug: 'loja', name: 'Loja' },
  lines: [{ key: 'k', productId: 'p1', name: 'X', unitCents: 1, quantity: 2, optionIds: ['o1'], optionLabels: ['A'], notes: '' }],
}
const form = { fulfillment: 'delivery_partner' as const, payment: 'cash' as const, customerName: 'Ana', customerPhone: '(35) 99999-0000', address: 'Rua A, 1, Centro', reference: '', notes: '', changeFor: '100' }

describe('checkout', () => {
  it('envia só ids e quantidades: nenhum preço vai ao servidor', () => {
    const args = repo.placeOrderArgs(cart, form, 'web-chave-1')
    expect(args._items).toEqual([{ product_id: 'p1', quantity: 2, option_ids: ['o1'], notes: null }])
    expect(JSON.stringify(args)).not.toMatch(/cents"?:\s*1\b|unitCents/)
    expect(args._change_for_cents).toBe(10000)
    expect(args._idempotency_key).toBe('web-chave-1')
  })
  it('retirada descarta endereço; troco só para dinheiro', () => {
    expect(repo.placeOrderArgs(cart, { ...form, fulfillment: 'pickup' }, 'web-chave-1')._delivery_address).toBeNull()
    expect(repo.checkoutSchema.safeParse({ ...form, payment: 'pix_on_delivery' }).success).toBe(false)
    expect(repo.checkoutSchema.safeParse({ ...form, address: '' }).success).toBe(false)
    expect(repo.checkoutSchema.safeParse({ ...form, fulfillment: 'pickup', address: '' }).success).toBe(true)
  })
  it('prévia da taxa de entrega por modalidade', () => {
    expect(repo.previewDeliveryFee('delivery_partner', { ownDeliveryFeeCents: 900 })).toBe(400)
    expect(repo.previewDeliveryFee('delivery_own', { ownDeliveryFeeCents: 900 })).toBe(900)
    expect(repo.previewDeliveryFee('pickup', { ownDeliveryFeeCents: 900 })).toBe(0)
  })
  it('cria o pedido pela função do servidor', async () => {
    h.fake.handler = () => ({ data: 'order-1', error: null })
    await expect(repo.placeOrder(cart, form, 'web-chave-1')).resolves.toBe('order-1')
    expect(h.fake.queries[0]).toMatchObject({ table: 'place_order', op: 'rpc' })
  })
})

describe('status do pedido', () => {
  it('botões da equipe seguem as transições do servidor', () => {
    expect(repo.staffNextSteps('placed', 'pickup')).toEqual(['accepted', 'rejected'])
    expect(repo.staffNextSteps('ready', 'delivery_partner')).toEqual(['cancelled'])
    expect(repo.staffNextSteps('ready', 'delivery_own')).toEqual(['out_for_delivery', 'cancelled'])
    expect(repo.staffNextSteps('ready', 'pickup')).toEqual(['picked_up', 'cancelled'])
    expect(repo.staffNextSteps('out_for_delivery', 'delivery_partner')).toEqual([])
    expect(repo.staffNextSteps('delivered', 'delivery_own')).toEqual([])
  })
  it('relatório calcula o líquido do estabelecimento', async () => {
    h.fake.handler = () => ({ data: { orders_total: 3, orders_completed: 2, orders_cancelled: 1, gross_cents: 10000, commission_cents: 140, delivery_costs_cents: 300, top_products: [] }, error: null })
    await expect(repo.getSalesSummary('b1', 30)).resolves.toMatchObject({ netCents: 9560, ordersCompleted: 2 })
  })
})
