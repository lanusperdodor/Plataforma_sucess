import { describe, expect, it } from 'vitest'
import { gestaoNav, nicheOf } from './nav.ts'

const labels = (n: Parameters<typeof gestaoNav>[0]) => gestaoNav(n).map((i) => i.label)

describe('Tucaí Gestão — menu por nicho', () => {
  it('identifica o nicho pelo tipo e pela categoria', () => {
    expect(nicheOf('restaurante', 'Hamburgueria')).toBe('restaurante')
    expect(nicheOf('loja', 'Mercadinho mercado')).toBe('mercadinho')
    expect(nicheOf('loja', 'Moda moda')).toBe('loja')
    expect(nicheOf('servico', null)).toBe('servico')
  })
  it('restaurante tem cardápio, cozinha, comandas/mesas e caixa', () => {
    const l = labels('restaurante')
    expect(l).toEqual(expect.arrayContaining(['Visão geral', 'Minha loja', 'Cardápio', 'Pedidos recebidos', 'Cozinha', 'Comandas e mesas', 'Caixa', 'Meu lucro', 'Equipe', 'Relatórios', 'Configurações']))
  })
  it('mercadinho tem produtos e separação; não tem mesas', () => {
    const l = labels('mercadinho')
    expect(l).toEqual(expect.arrayContaining(['Produtos', 'Separação', 'Comandas de balcão']))
    expect(l).not.toContain('Comandas e mesas')
  })
  it('lojas e serviços não veem mesas nem cozinha', () => {
    for (const n of ['loja', 'servico'] as const) {
      const l = labels(n)
      expect(l).not.toContain('Comandas e mesas')
      expect(l).not.toContain('Cozinha')
    }
    expect(labels('loja')).toContain('Catálogo')
    expect(labels('servico')).toEqual(expect.arrayContaining(['Serviços', 'Agenda e horários']))
    expect(labels('servico')).not.toContain('Caixa')
  })
  it('módulos Premium vêm marcados', () => {
    const prem = gestaoNav('restaurante').filter((i) => i.premium).map((i) => i.label)
    expect(prem).toEqual(['Comandas e mesas', 'Caixa', 'Controle de gastos', 'Meu lucro'])
  })
})
