import { describe, expect, it } from 'vitest'
import { isOpenNow, localParts, nextOpening, type HoursWindow } from './time.ts'

// America/Sao_Paulo = UTC-3 (sem horário de verão). 2025-01-06 é segunda-feira.
const at = (local: string) => new Date(`${local}-03:00`)

const day: HoursWindow[] = [{ weekday: 1, opens: '11:00', closes: '22:00:00' }]
const night: HoursWindow[] = [{ weekday: 5, opens: '18:00', closes: '02:00' }] // sexta

describe('localParts', () => {
  it('converte UTC para o fuso de São Paulo', () => {
    expect(localParts(new Date('2025-01-06T02:30:00Z'))).toEqual({ weekday: 0, minutes: 23 * 60 + 30 })
  })
})

describe('isOpenNow', () => {
  it('aberto dentro da janela e fechado fora', () => {
    expect(isOpenNow(day, at('2025-01-06T12:00:00'))).toBe(true)
    expect(isOpenNow(day, at('2025-01-06T10:59:00'))).toBe(false)
    expect(isOpenNow(day, at('2025-01-06T22:00:00'))).toBe(false)
    expect(isOpenNow(day, at('2025-01-07T12:00:00'))).toBe(false)
  })

  it('janela que atravessa a meia-noite vale até o dia seguinte', () => {
    expect(isOpenNow(night, at('2025-01-10T23:00:00'))).toBe(true) // sexta 23h
    expect(isOpenNow(night, at('2025-01-11T01:59:00'))).toBe(true) // sábado 01:59
    expect(isOpenNow(night, at('2025-01-11T02:00:00'))).toBe(false)
    expect(isOpenNow(night, at('2025-01-10T17:59:00'))).toBe(false)
  })

  it('sem janelas está fechado', () => {
    expect(isOpenNow([], at('2025-01-06T12:00:00'))).toBe(false)
  })
})

describe('nextOpening', () => {
  it('abre hoje mais tarde', () => {
    expect(nextOpening(day, at('2025-01-06T09:00:00'))?.toISOString()).toBe('2025-01-06T14:00:00.000Z')
  })

  it('depois de fechar, vai para a próxima semana', () => {
    expect(nextOpening(day, at('2025-01-06T23:00:00'))?.toISOString()).toBe('2025-01-13T14:00:00.000Z')
  })

  it('considera janela noturna da sexta', () => {
    expect(nextOpening(night, at('2025-01-11T10:00:00'))?.toISOString()).toBe('2025-01-17T21:00:00.000Z')
  })

  it('retorna null sem janelas', () => {
    expect(nextOpening([], new Date())).toBeNull()
  })
})
