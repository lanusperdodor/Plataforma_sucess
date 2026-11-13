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

const o = (fulfillment: string, subtotal: number, extra: Record<string, number> = {}) => ({
  fulfillment, subtotal_cents: subtotal, delivery_fee_cents: 0, total_cents: subtotal, commission_cents: 0,
  merchant_delivery_contribution_cents: 0, platform_delivery_fee_cents: 0, ...extra,
})

describe('dinheiro do mês no Início do empresário', () => {
  it('separa vendas, comissão e taxas de entrega (parceira = contribuição; própria = tarifa; nunca as duas somadas)', async () => {
    h.fake.handler = () => ({
      data: [
        o('delivery_partner', 6000, { delivery_fee_cents: 400, commission_cents: 120, merchant_delivery_contribution_cents: 200, platform_delivery_fee_cents: 100 }),
        o('delivery_own', 3000, { delivery_fee_cents: 500, platform_delivery_fee_cents: 100 }),
        o('pickup', 2000),
      ],
      error: null,
    })
    const m = await repo.getMonthMoney('b1')
    expect(m).toMatchObject({
      orders: 3, deliveries: 2, partnerDeliveries: 1, ownDeliveries: 1,
      receivedCents: 6000 + 3000 + 500 + 2000, commissionCents: 120, commissionOrders: 1, commissionBaseCents: 6000,
      partnerFeesCents: 200, ownFeesCents: 100, deliveryFeesCents: 300,
    })
    const q = h.fake.queries[0]!
    expect(q.table).toBe('orders')
    expect(q.filters).toContainEqual({ kind: 'eq', column: 'business_id', value: 'b1' })
  })
})
