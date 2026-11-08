import { describe, expect, it } from 'vitest'
import { keyCheckerboard } from './checkerKey'

function img(w: number, h: number, fill: (x: number, y: number) => [number, number, number]) {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fill(x, y)
      px.set([r, g, b, 255], (y * w + x) * 4)
    }
  return px
}
const alpha = (px: Uint8ClampedArray, w: number, x: number, y: number) => px[(y * w + x) * 4 + 3]

describe('keyCheckerboard', () => {
  it('remove o xadrez externo e preserva o interior fechado por contorno escuro', () => {
    const w = 20, h = 20
    const px = img(w, h, (x, y) => {
      if (x >= 5 && x <= 14 && y >= 5 && y <= 14) {
        if (x === 5 || x === 14 || y === 5 || y === 14) return [20, 20, 20] // contorno preto
        return [220, 220, 220] // interior cinza claro (ex.: peito/balão) — não pode sumir
      }
      return (Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? [178, 178, 178] : [220, 220, 220]
    })
    keyCheckerboard(px, w, h)
    expect(alpha(px, w, 0, 0)).toBe(0)
    expect(alpha(px, w, 19, 19)).toBe(0)
    expect(alpha(px, w, 10, 10)).toBe(255)
    expect(alpha(px, w, 5, 10)).toBe(255)
  })
  it('não remove cores (bico laranja) e limpa retângulos pedidos', () => {
    const w = 10, h = 10
    const px = img(w, h, (x) => (x < 5 ? [255, 120, 20] : [200, 200, 200]))
    keyCheckerboard(px, w, h, { clear: [{ x: 0, y: 8, w: 2, h: 2 }] })
    expect(alpha(px, w, 2, 2)).toBe(255)
    expect(alpha(px, w, 7, 2)).toBe(0)
    expect(alpha(px, w, 0, 9)).toBe(0)
  })

  it('remove bolsão de xadrez cercado pelo desenho, mas não um interior liso', () => {
    const w = 30, h = 12
    const px = img(w, h, (x, y) => {
      const ring = (x0: number) => x >= x0 && x <= x0 + 9 && y >= 1 && y <= 10
      const edge = (x0: number) => x === x0 || x === x0 + 9 || y === 1 || y === 10
      if (ring(2)) return edge(2) ? [20, 20, 20] : (x + y) % 2 ? [178, 178, 178] : [220, 220, 220] // xadrez preso
      if (ring(16)) return edge(16) ? [20, 20, 20] : [215, 215, 215] // interior liso (peito)
      return [178, 178, 178]
    })
    keyCheckerboard(px, w, h)
    expect(alpha(px, w, 6, 5)).toBe(0)
    expect(alpha(px, w, 20, 5)).toBe(255)
  })
})