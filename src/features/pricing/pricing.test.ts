import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRICING_CONFIG,
  assertPartnerDeliveryFunded,
  calculateCommissionCents,
  calculateOrder,
} from './pricing.ts'

const partner = (subtotalCents: number) => calculateOrder({ subtotalCents, mode: 'partner_delivery' })

describe('comissão percentual', () => {
  it.each([
    [2800, 0],
    [5000, 0],
    [5600, 112],
    [6400, 128],
  ])('subtotal %i → comissão %i', (subtotal, expected) => {
    expect(calculateCommissionCents(subtotal, DEFAULT_PRICING_CONFIG)).toBe(expected)
  })

  it('aplica 2% sobre TODO o subtotal acima de R$ 50 (R$ 50,01)', () => {
    expect(calculateCommissionCents(5001, DEFAULT_PRICING_CONFIG)).toBe(100)
  })

  it('rejeita valores não inteiros ou negativos', () => {
    expect(() => calculateCommissionCents(10.5, DEFAULT_PRICING_CONFIG)).toThrow()
    expect(() => calculateCommissionCents(-1, DEFAULT_PRICING_CONFIG)).toThrow()
  })
})

describe('entrega parceira', () => {
  it('pedido de R$ 28', () => {
    const r = partner(2800)
    expect(r.customerTotalCents).toBe(3200)
    expect(r.merchantNetCents).toBe(2600)
    expect(r.courierPayCents).toBe(500)
    expect(r.platformRevenueCents).toBe(100)
  })

  it('pedido de R$ 64', () => {
    const r = partner(6400)
    expect(r.customerTotalCents).toBe(6800)
    expect(r.merchantNetCents).toBe(6072)
    expect(r.courierPayCents).toBe(500)
    expect(r.platformRevenueCents).toBe(228)
  })

  it('distribuição 4 + 2 = 5 + 1', () => {
    const r = partner(2800)
    expect(r.customerDeliveryFeeCents + r.merchantDeliveryContributionCents).toBe(
      r.courierPayCents + r.platformLogisticsFeeCents,
    )
  })

  it('recusa configuração em que o entregador não está financiado', () => {
    expect(() =>
      assertPartnerDeliveryFunded({ ...DEFAULT_PRICING_CONFIG.partnerDelivery, courierPayCents: 600 }),
    ).toThrow(/não financiado/)
  })

  it('conserva dinheiro: total do cliente = restaurante + entregador + plataforma', () => {
    for (const s of [100, 2800, 5000, 5001, 5600, 6400, 123456]) {
      const r = partner(s)
      expect(r.customerTotalCents).toBe(r.merchantNetCents + r.courierPayCents + r.platformRevenueCents)
    }
  })
})

describe('entrega própria', () => {
  it('não aplica os R$ 5 do parceiro; cobra R$ 1 da plataforma do restaurante', () => {
    const r = calculateOrder({ subtotalCents: 6400, mode: 'own_delivery', ownDeliveryFeeCents: 700 })
    expect(r.courierPayCents).toBe(0)
    expect(r.customerTotalCents).toBe(7100)
    expect(r.platformLogisticsFeeCents).toBe(100)
    expect(r.platformRevenueCents).toBe(228)
    expect(r.merchantNetCents).toBe(6400 + 700 - 128 - 100)
  })
})

describe('retirada', () => {
  it('não gera receita de entrega; comissão segue a regra', () => {
    const a = calculateOrder({ subtotalCents: 2800, mode: 'pickup' })
    expect(a.platformRevenueCents).toBe(0)
    expect(a.customerTotalCents).toBe(2800)
    const b = calculateOrder({ subtotalCents: 6400, mode: 'pickup' })
    expect(b.platformRevenueCents).toBe(128)
    expect(b.merchantNetCents).toBe(6272)
  })
})

describe('snapshot', () => {
  it('é independente da configuração posterior', () => {
    const cfg = structuredClone(DEFAULT_PRICING_CONFIG)
    const r = calculateOrder({ subtotalCents: 6400, mode: 'partner_delivery' }, cfg)
    cfg.commissionBps = 500
    expect(r.configSnapshot.commissionBps).toBe(200)
  })
})
