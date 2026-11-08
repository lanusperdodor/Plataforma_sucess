import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { readStorage, writeStorage } from './storage'

const schema = z.object({ n: z.number() })

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})

describe('storage', () => {
  it('grava e lê valor válido', () => {
    expect(writeStorage('k', { n: 1 })).toBe(true)
    expect(readStorage('k', schema)).toEqual({ n: 1 })
  })

  it('descarta JSON inválido e dado que falha no schema', () => {
    localStorage.setItem('k', '{oops')
    expect(readStorage('k', schema)).toBeNull()
    expect(localStorage.getItem('k')).toBeNull()
    localStorage.setItem('k', JSON.stringify({ n: 'x' }))
    expect(readStorage('k', schema)).toBeNull()
    expect(localStorage.getItem('k')).toBeNull()
  })

  it('usa sessionStorage quando pedido', () => {
    writeStorage('s', { n: 2 }, 'session')
    expect(readStorage('s', schema, 'session')).toEqual({ n: 2 })
    expect(localStorage.getItem('s')).toBeNull()
  })

  it('não lança quando setItem falha (quota)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })
    expect(writeStorage('k', { n: 1 })).toBe(false)
  })

  it('não lança quando o storage está indisponível', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(readStorage('k', schema)).toBeNull()
    expect(writeStorage('k', { n: 1 })).toBe(false)
  })
})
