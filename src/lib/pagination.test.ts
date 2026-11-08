import { describe, expect, it } from 'vitest'
import { pageRange, toPage } from './pagination'

describe('pagination', () => {
  it('pageRange pede size + 1 linhas', () => {
    expect(pageRange(0, 12)).toEqual({ from: 0, to: 12 })
    expect(pageRange(2, 12)).toEqual({ from: 24, to: 36 })
    expect(pageRange(-1, 12)).toEqual({ from: 0, to: 12 })
  })

  it('toPage calcula hasMore e nextPage', () => {
    const rows = Array.from({ length: 13 }, (_, i) => i)
    expect(toPage(rows, 12, 1)).toEqual({ items: rows.slice(0, 12), hasMore: true, nextPage: 2 })
    expect(toPage([1, 2], 12)).toEqual({ items: [1, 2], hasMore: false, nextPage: null })
    expect(toPage(rows.slice(0, 12), 12).hasMore).toBe(false)
  })
})
