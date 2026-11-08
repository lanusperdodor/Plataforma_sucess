import { describe, expect, it } from 'vitest'
import { assertCents, formatBRL, parseBRL } from './money'
import { RepositoryError, mapPostgrestError } from './errors'

describe('money', () => {
  it('formata centavos em BRL', () => {
    expect(formatBRL(0)).toBe('R$ 0,00')
    expect(formatBRL(5)).toBe('R$ 0,05')
    expect(formatBRL(123456)).toBe('R$ 1.234,56')
    expect(formatBRL(100000000)).toBe('R$ 1.000.000,00')
  })
  it('rejeita valores não inteiros ou negativos', () => {
    expect(() => formatBRL(1.5)).toThrow(RangeError)
    expect(() => formatBRL(-1)).toThrow(RangeError)
    expect(() => assertCents(NaN)).toThrow(RangeError)
    expect(assertCents(10)).toBe(10)
  })
  it('faz parse ida e volta', () => {
    for (const c of [0, 1, 99, 100, 123456, 100000000]) expect(parseBRL(formatBRL(c))).toBe(c)
    expect(parseBRL('12')).toBe(1200)
    expect(parseBRL('12,5')).toBe(1250)
    expect(parseBRL('R$\u00a01.234,56')).toBe(123456)
  })
  it('rejeita texto inválido', () => {
    expect(() => parseBRL('abc')).toThrow(RangeError)
    expect(() => parseBRL('-5,00')).toThrow(RangeError)
    expect(() => parseBRL('')).toThrow(RangeError)
  })
})

describe('mapPostgrestError', () => {
  it('mapeia códigos conhecidos', () => {
    expect(mapPostgrestError({ code: '42501', message: 'x' }).code).toBe('forbidden')
    expect(mapPostgrestError({ code: 'PGRST116', message: 'x' }).code).toBe('not_found')
    expect(mapPostgrestError({ code: '23505', message: 'x' }).code).toBe('conflict')
  })
  it('usa a mensagem do servidor em P0001', () => {
    const err = mapPostgrestError({ code: 'P0001', message: 'Restaurante fechado' })
    expect(err).toBeInstanceOf(RepositoryError)
    expect(err.code).toBe('business_rule')
    expect(err.message).toBe('Restaurante fechado')
  })
  it('detecta falha de rede e desconhecidos', () => {
    expect(mapPostgrestError({ message: 'TypeError: Failed to fetch' }).code).toBe('network')
    const u = mapPostgrestError({ code: '99999', message: 'boom' })
    expect(u.code).toBe('unknown')
    expect(u.message).toMatch(/Tente novamente/)
  })
})
