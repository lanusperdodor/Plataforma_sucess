import { act, renderHook } from '@testing-library/react'
import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBreakpoint } from './useBreakpoint.ts'
import { nextCompactState } from './useCompactHeader.ts'

/** **Validates: Requirements 16.1, 16.2** */
describe('nextCompactState', () => {
  it('aplica a histerese 8/48', () => {
    expect(nextCompactState(false, 49)).toBe(true)
    expect(nextCompactState(true, 8)).toBe(false)
    expect(nextCompactState(false, 48)).toBe(false)
    expect(nextCompactState(true, 48)).toBe(true)
    expect(nextCompactState(false, 30)).toBe(false)
    expect(nextCompactState(true, 30)).toBe(true)
  })

  it('propriedade: compacta >48, expande <=8, mantém entre', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.double({ min: 0, max: 5000, noNaN: true }), (prev, y) => {
        const next = nextCompactState(prev, y)
        if (y > 48) return next === true
        if (y <= 8) return next === false
        return next === prev
      }),
    )
  })
})

type Listener = () => void

function mockMatchMedia(initialWidth: number) {
  let width = initialWidth
  const listeners = new Set<Listener>()
  window.matchMedia = ((query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0)
    return {
      get matches() {
        return width >= min
      },
      media: query,
      addEventListener: (_: string, l: Listener) => listeners.add(l),
      removeEventListener: (_: string, l: Listener) => listeners.delete(l),
    }
  }) as unknown as typeof window.matchMedia
  return (w: number) => {
    width = w
    listeners.forEach((l) => l())
  }
}

describe('useBreakpoint', () => {
  const original = window.matchMedia
  afterEach(() => {
    window.matchMedia = original
    vi.restoreAllMocks()
  })

  it.each([
    [375, 'mobile'],
    [767, 'mobile'],
    [768, 'tablet'],
    [800, 'tablet'],
    [1023, 'tablet'],
    [1024, 'desktop'],
    [1280, 'desktop'],
  ])('largura %i => %s', (w, expected) => {
    mockMatchMedia(w)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe(expected)
  })

  it('reage a mudanças de largura', () => {
    const resize = mockMatchMedia(375)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('mobile')
    act(() => resize(1280))
    expect(result.current).toBe('desktop')
  })

  it('cai para mobile sem matchMedia', () => {
    // @ts-expect-error simula ambiente sem matchMedia
    window.matchMedia = undefined
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('mobile')
  })
})
