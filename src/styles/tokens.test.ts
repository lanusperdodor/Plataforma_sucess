import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../lib/color'

const css = readFileSync('src/styles/tokens.css', 'utf8')
const token = (name: string): string => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!m?.[1]) throw new Error(`token ${name} ausente`)
  return m[1]
}

describe('tokens.css', () => {
  it('textos e acentos atingem contraste AA (>= 4,5:1)', () => {
    const pairs: Array<[string, string]> = [
      ['text', 'surface'],
      ['text', 'surface-muted'],
      ['text-muted', 'surface'],
      ['text-muted', 'surface-muted'],
      ['brand-primary', 'surface-muted'],
      ['brand-accent', 'surface'],
      ['accent-warm', 'surface'],
      ['accent-warm', 'accent-warm-soft'],
      ['text', 'brand-orange'], // texto carvão sobre o laranja Tucaí
    ]
    for (const [fg, bg] of pairs) {
      expect(contrastRatio(token(fg), token(bg)), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrastRatio('#ffffff', token('brand-primary'))).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#ffffff', token('brand-accent'))).toBeGreaterThanOrEqual(4.5)
  })

  it('identidade Tucaí: carvão #17191B e laranja #FF5500', () => {
    expect(token('brand-primary').toLowerCase()).toBe('#17191b')
    expect(token('brand-orange').toLowerCase()).toBe('#ff5500')
  })

  it('body não aplica padding de área segura e hover exige ponteiro fino', () => {
    expect(css).not.toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom\)/)
    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\)/)
  })
})
