import { describe, expect, it } from 'vitest'
import { cityActions, formatKm, parseIbgeCode } from './AdminCities.tsx'

describe('cityActions', () => {
  it('planejada só ativa; ativa só suspende; suspensa reativa ou volta a planejada', () => {
    expect(cityActions('planned').map((a) => a.to)).toEqual(['active'])
    expect(cityActions('active').map((a) => a.to)).toEqual(['suspended'])
    expect(cityActions('suspended').map((a) => a.to)).toEqual(['active', 'planned'])
  })
})

describe('parseIbgeCode', () => {
  it('aceita apenas 7 dígitos', () => {
    expect(parseIbgeCode(' 3133758 ')).toBe(3133758)
    expect(parseIbgeCode('313375')).toBeNull()
    expect(parseIbgeCode('31337580')).toBeNull()
    expect(parseIbgeCode('31a3758')).toBeNull()
  })
})

describe('formatKm', () => {
  it('formata em pt-BR', () => {
    expect(formatKm(15.1)).toBe('15,1 km')
    expect(formatKm(null)).toBe('—')
  })
})
