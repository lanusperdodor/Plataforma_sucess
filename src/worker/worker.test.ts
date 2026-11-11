import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { headTags } from './index'
import { SECURITY_HEADERS } from './securityHeaders'

describe('Worker', () => {
  it('cabeçalhos de segurança iguais aos de public/_headers', () => {
    const lines = readFileSync(resolve(__dirname, '../../public/_headers'), 'utf8').split('\n')
    const start = lines.indexOf('/*')
    const fromFile: Record<string, string> = {}
    for (const l of lines.slice(start + 1)) {
      if (!l.startsWith('  ')) break
      const i = l.indexOf(':')
      fromFile[l.slice(0, i).trim()] = l.slice(i + 1).trim()
    }
    expect(SECURITY_HEADERS).toEqual(fromFile)
  })
  it('canonical, og:url e noindex no HTML', () => {
    const meta = { title: 'T', description: 'D "x" <y>', index: true, canonicalPath: '/lojas/a' }
    const tags = headTags(meta, 'https://x.example', true)
    expect(tags).toContain('<link rel="canonical" href="https://x.example/lojas/a" />')
    expect(tags).toContain('content="D &quot;x&quot; &lt;y>"')
    expect(tags).not.toContain('noindex')
    expect(headTags(meta, 'https://x.example', false)).toContain('noindex, nofollow')
  })
})
