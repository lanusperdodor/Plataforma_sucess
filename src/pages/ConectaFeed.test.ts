import { describe, expect, it } from 'vitest'
import { interleave } from './ConectaPage.tsx'

describe('distribuição de patrocinados no feed', () => {
  it('primeiro no topo e depois um a cada N publicações', () => {
    const r = interleave(['a', 'b', 'c', 'd', 'e', 'f', 'g'], ['X', 'Y', 'Z'], 3)
    expect(r.map((x) => (x.sponsored ? `*${x.item}` : x.item))).toEqual(['*X', 'a', 'b', 'c', '*Y', 'd', 'e', 'f', '*Z', 'g'])
  })
  it('sem excesso: nunca mais patrocinados que o disponível', () => {
    expect(interleave(['a', 'b'], ['X', 'Y', 'Z'], 6).filter((x) => x.sponsored)).toHaveLength(1)
    expect(interleave([], ['X'], 6)).toEqual([{ item: 'X', sponsored: true }])
  })
})
