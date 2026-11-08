import { describe, expect, it } from 'vitest'
import { getBoolean, getEnum, getList, getNumber, getString, setParams } from './url-state'

describe('url-state', () => {
  const p = new URLSearchParams('q=pizza&n=3&bad=x&open=true&tag=a,b&tag=c&sort=price')

  it('lê valores tipados', () => {
    expect(getString(p, 'q')).toBe('pizza')
    expect(getString(p, 'missing')).toBeUndefined()
    expect(getNumber(p, 'n')).toBe(3)
    expect(getNumber(p, 'bad')).toBeUndefined()
    expect(getBoolean(p, 'open')).toBe(true)
    expect(getList(p, 'tag')).toEqual(['a', 'b', 'c'])
    expect(getEnum(p, 'sort', ['price', 'rating'] as const)).toBe('price')
    expect(getEnum(p, 'q', ['price'] as const)).toBeUndefined()
  })

  it('setParams atualiza, remove e não muta o original', () => {
    const next = setParams(p, { q: null, n: 5, tag: ['x', 'y'], extra: '' })
    expect(next.has('q')).toBe(false)
    expect(next.get('n')).toBe('5')
    expect(next.getAll('tag')).toEqual(['x', 'y'])
    expect(next.has('extra')).toBe(false)
    expect(p.get('q')).toBe('pizza')
  })
})
