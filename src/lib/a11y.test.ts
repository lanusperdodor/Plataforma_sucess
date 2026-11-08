import { afterEach, describe, expect, it, vi } from 'vitest'
import { animateScrollTo } from './a11y'

function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia
}

afterEach(() => vi.restoreAllMocks())

describe('animateScrollTo', () => {
  it('rola imediatamente com movimento reduzido', () => {
    mockMatchMedia(true)
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    animateScrollTo(500)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith(0, 500)
    expect(raf).not.toHaveBeenCalled()
  })

  it('anima por 300 ms via requestAnimationFrame e termina no destino', () => {
    mockMatchMedia(false)
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb)
      return frames.length
    })
    animateScrollTo(400)
    frames.shift()!(1000)
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0)
    frames.shift()!(1150)
    const mid = scrollTo.mock.calls.at(-1)![1] as number
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(400)
    frames.shift()!(1300)
    expect(scrollTo).toHaveBeenLastCalledWith(0, 400)
    expect(frames).toHaveLength(0)
  })
})
