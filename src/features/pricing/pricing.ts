/**
 * Motor de preços (espelho para exibição). A fonte da verdade é o backend.
 * Todos os valores em CENTAVOS inteiros. Regras: .kiro/steering/business-rules.md
 */

export type FulfillmentMode = 'partner_delivery' | 'own_delivery' | 'pickup'

export interface PricingConfig {
  /** Acima deste subtotal (exclusivo) incide comissão. */
  commissionThresholdCents: number
  /** Comissão em pontos-base (200 = 2%). */
  commissionBps: number
  partnerDelivery: {
    customerFeeCents: number
    merchantContributionCents: number
    courierPayCents: number
    platformFeeCents: number
  }
  ownDelivery: {
    /** Taxa de tecnologia por entrega gerenciada, cobrada do restaurante. */
    platformFeeCents: number
  }
}

/** Valores aprovados. Alterações só pelo Master, nunca retroativas. */
export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  commissionThresholdCents: 5000,
  commissionBps: 200,
  partnerDelivery: {
    customerFeeCents: 400,
    merchantContributionCents: 200,
    courierPayCents: 500,
    platformFeeCents: 100,
  },
  ownDelivery: { platformFeeCents: 100 },
}

export interface OrderInput {
  subtotalCents: number
  mode: FulfillmentMode
  /** Frete cobrado do cliente pelo restaurante (somente entrega própria). */
  ownDeliveryFeeCents?: number
}

export interface OrderBreakdown {
  mode: FulfillmentMode
  subtotalCents: number
  commissionCents: number
  customerDeliveryFeeCents: number
  merchantDeliveryContributionCents: number
  courierPayCents: number
  platformLogisticsFeeCents: number
  customerTotalCents: number
  merchantNetCents: number
  platformRevenueCents: number
  /** Snapshot da configuração vigente, gravado no pedido. */
  configSnapshot: PricingConfig
}

function assertCents(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} deve ser um inteiro não negativo (centavos)`)
  }
}

export function calculateCommissionCents(subtotalCents: number, config: PricingConfig): number {
  assertCents(subtotalCents, 'subtotalCents')
  if (subtotalCents <= config.commissionThresholdCents) return 0
  return Math.round((subtotalCents * config.commissionBps) / 10000)
}

/** O pagamento do entregador e a receita logística precisam estar financiados antes da confirmação. */
export function assertPartnerDeliveryFunded(c: PricingConfig['partnerDelivery']): void {
  const funding = c.customerFeeCents + c.merchantContributionCents
  const obligations = c.courierPayCents + c.platformFeeCents
  if (funding !== obligations) {
    throw new Error(
      `Frete parceiro não financiado: arrecadação ${funding} != obrigações ${obligations}`,
    )
  }
}

export function calculateOrder(
  input: OrderInput,
  config: PricingConfig = DEFAULT_PRICING_CONFIG,
): OrderBreakdown {
  assertCents(input.subtotalCents, 'subtotalCents')
  const commissionCents = calculateCommissionCents(input.subtotalCents, config)
  const base = {
    mode: input.mode,
    subtotalCents: input.subtotalCents,
    commissionCents,
    configSnapshot: structuredClone(config),
  }

  if (input.mode === 'pickup') {
    return {
      ...base,
      customerDeliveryFeeCents: 0,
      merchantDeliveryContributionCents: 0,
      courierPayCents: 0,
      platformLogisticsFeeCents: 0,
      customerTotalCents: input.subtotalCents,
      merchantNetCents: input.subtotalCents - commissionCents,
      platformRevenueCents: commissionCents,
    }
  }

  if (input.mode === 'own_delivery') {
    const ownFee = input.ownDeliveryFeeCents ?? 0
    assertCents(ownFee, 'ownDeliveryFeeCents')
    const platformFee = config.ownDelivery.platformFeeCents
    return {
      ...base,
      customerDeliveryFeeCents: ownFee,
      merchantDeliveryContributionCents: 0,
      courierPayCents: 0, // o restaurante paga seu próprio entregador
      platformLogisticsFeeCents: platformFee,
      customerTotalCents: input.subtotalCents + ownFee,
      merchantNetCents: input.subtotalCents + ownFee - commissionCents - platformFee,
      platformRevenueCents: commissionCents + platformFee,
    }
  }

  const p = config.partnerDelivery
  assertPartnerDeliveryFunded(p)
  return {
    ...base,
    customerDeliveryFeeCents: p.customerFeeCents,
    merchantDeliveryContributionCents: p.merchantContributionCents,
    courierPayCents: p.courierPayCents,
    platformLogisticsFeeCents: p.platformFeeCents,
    customerTotalCents: input.subtotalCents + p.customerFeeCents,
    merchantNetCents: input.subtotalCents - commissionCents - p.merchantContributionCents,
    platformRevenueCents: commissionCents + p.platformFeeCents,
  }
}
