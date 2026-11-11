import { describe, expect, it, vi } from 'vitest'
vi.mock('../../features/admin/repository.ts', () => ({}))
vi.mock('../../components/feedback/toast-context.ts', () => ({ useToast: () => ({}) }))
import { toCsv } from './FinanceReport.tsx'

describe('exportação CSV do financeiro', () => {
  it('gera CSV com ; e valores em reais, escapando textos', () => {
    const csv = toCsv([{ kind: 'pedido', ref: 'ABC123', at: '2026-11-11T12:00:00Z', business: 'Bar; do "Zé"', city: 'Passos - MG', description: 'Pedido (retirada)',
      status: 'delivered', amountCents: 6200, platformCents: 116, courierCents: 0, method: 'cash', total: 1 }])
    const [head, line] = csv.replace('﻿', '').split('\r\n')
    expect(head).toContain('Valor (R$)')
    expect(line).toContain('"Bar; do ""Zé"""')
    expect(line).toContain(';62,00;1,16;0,00;cash')
    expect(line).toContain('Entregue')
  })
})
