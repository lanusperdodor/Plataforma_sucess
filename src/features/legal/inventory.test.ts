import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STORAGE_ITEMS, USES_NON_ESSENTIAL_TRACKING } from './inventory'

function sources(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) out.push(readFileSync(p, 'utf8'))
    }
  }
  walk(resolve(__dirname, '../..'))
  return out
}

describe('inventário de armazenamento local', () => {
  it('toda chave de armazenamento usada no código está declarada no inventário', () => {
    const declared = STORAGE_ITEMS.map((i) => i.key.replace(/<.*$/, ''))
    const used = new Set<string>()
    for (const src of sources()) {
      for (const m of src.matchAll(/_KEY = '([^']+)'/g)) used.add(m[1]!)
      for (const m of src.matchAll(/=> `([a-z]+:)\$\{/g)) used.add(m[1]!)
    }
    for (const key of used) expect(declared.some((d) => key.startsWith(d) || d.startsWith(key))).toBe(true)
  })
  it('não há cookies nem rastreamento não essencial (sem banner a exibir)', () => {
    expect(sources().some((s) => /document\.cookie/.test(s))).toBe(false)
    expect(USES_NON_ESSENTIAL_TRACKING).toBe(false)
  })
})
