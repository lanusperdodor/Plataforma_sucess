import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { headTags, shellHtml } from './index'
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
  it('Open Graph com imagem padrão, Twitter e JSON-LD só quando indexável; conteúdo sem JS escapado', () => {
    const meta = { title: 'T', description: 'D', index: true, canonicalPath: '/', jsonLd: [{ '@type': 'Organization' }], shell: { heading: 'A <b>', text: 'B', links: [{ href: '/lojas', label: 'Lojas' }] } }
    const tags = headTags(meta, 'https://x.example', true)
    expect(tags).toContain('<meta property="og:image" content="https://x.example/brand/og-tucai.jpg" />')
    expect(tags).toContain('<meta property="og:image:width" content="1200" />')
    expect(tags).toContain('<meta name="twitter:card" content="summary_large_image" />')
    expect(tags).toContain('<script type="application/ld+json">{"@type":"Organization"}</script>')
    expect(headTags(meta, 'https://x.example', false)).not.toContain('ld+json')
    expect(headTags({ ...meta, image: 'https://cdn.example/capa.jpg' }, 'https://x.example', true)).toContain('content="https://cdn.example/capa.jpg"')
    expect(shellHtml(meta)).toBe('<div class="seo-shell"><h1>A &lt;b&gt;</h1><p>B</p><ul><li><a href="/lojas">Lojas</a></li></ul></div>')
  })
})
