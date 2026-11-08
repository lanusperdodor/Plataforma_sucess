import { act, renderHook } from '@testing-library/react'
import fc from 'fast-check'
import { beforeEach, describe, expect, it } from 'vitest'
import { RECENT_KEY, RECENT_MAX, addRecent, clearRecent, listRecent, useRecent } from './recentStore'
import type { RecentInput } from './recentStore'

const mk = (id: string, kind: RecentInput['kind'] = 'loja'): RecentInput => ({
  kind,
  id,
  name: `Item ${id}`,
  isDemo: false,
})

describe('recentStore', () => {
  beforeEach(() => {
    clearRecent()
  })

  it('limita a 12 itens, mantendo os mais recentes', () => {
    for (let i = 0; i < 15; i++) addRecent(mk(String(i)))
    const list = listRecent()
    expect(list).toHaveLength(RECENT_MAX)
    expect(list[0]?.id).toBe('14')
    expect(list[11]?.id).toBe('3')
  })

  it('dedupe move o item existente para o topo (por kind+id)', () => {
    addRecent(mk('a'))
    addRecent(mk('b'))
    addRecent(mk('a', 'vaga'))
    addRecent(mk('a'))
    expect(listRecent().map((i) => `${i.kind}:${i.id}`)).toEqual(['loja:a', 'vaga:a', 'loja:b'])
  })

  it('dado corrompido resulta em lista vazia', () => {
    window.localStorage.setItem(RECENT_KEY, '{nao-json')
    expect(listRecent()).toEqual([])
    window.localStorage.setItem(RECENT_KEY, JSON.stringify([{ kind: 'x' }]))
    expect(listRecent()).toEqual([])
  })

  it('clearRecent esvazia a lista', () => {
    addRecent(mk('a'))
    clearRecent()
    expect(listRecent()).toEqual([])
  })

  it('useRecent tem snapshot estável, notifica e sincroniza via evento storage', () => {
    const { result } = renderHook(() => useRecent())
    const first = result.current
    expect(first).toEqual([])
    act(() => addRecent(mk('a')))
    expect(result.current.map((i) => i.id)).toEqual(['a'])
    const second = result.current
    const { rerender } = renderHook(() => useRecent())
    rerender()
    expect(result.current).toBe(second)

    act(() => {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify([{ ...second[0], id: 'z' }]))
      window.dispatchEvent(new StorageEvent('storage', { key: RECENT_KEY }))
    })
    expect(result.current.map((i) => i.id)).toEqual(['z'])
  })

  it('propriedade: no máximo 12, sem repetidos, último registrado no topo', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            kind: fc.constantFrom('restaurante', 'loja', 'servico', 'vaga', 'post' as const),
            id: fc.string({ minLength: 1, maxLength: 3 }),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        (seq) => {
          clearRecent()
          for (const s of seq) addRecent({ ...mk(s.id), kind: s.kind })
          const list = listRecent()
          const keys = list.map((i) => `${i.kind}:${i.id}`)
          const last = seq[seq.length - 1]!
          return (
            list.length <= RECENT_MAX &&
            new Set(keys).size === keys.length &&
            keys[0] === `${last.kind}:${last.id}`
          )
        },
      ),
    )
  })
})
