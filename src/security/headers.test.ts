import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const headersFile = readFileSync(resolve(root, 'public/_headers'), 'utf8')
const html = readFileSync(resolve(root, 'index.html'), 'utf8')

function header(name: string): string {
  const line = headersFile.split('\n').find((l) => l.trim().toLowerCase().startsWith(`${name.toLowerCase()}:`))
  return line ? line.slice(line.indexOf(':') + 1).trim() : ''
}

function csp(): Map<string, string[]> {
  return new Map(
    header('Content-Security-Policy')
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((p) => p[0])
      .map(([k, ...v]) => [k!, v]),
  )
}

describe('cabeçalhos de segurança (public/_headers)', () => {
  it('CSP estrita: scripts só do próprio site, sem inline/eval, sem frames e sem plugins', () => {
    const c = csp()
    expect(c.get('script-src')).toEqual(["'self'"])
    expect(header('Content-Security-Policy')).not.toMatch(/unsafe-inline|unsafe-eval|\*\s|'strict-dynamic'/)
    expect(c.get('frame-ancestors')).toEqual(["'none'"])
    expect(c.get('object-src')).toEqual(["'none'"])
    expect(c.get('base-uri')).toEqual(["'self'"])
    expect(c.get('form-action')).toEqual(["'self'"])
    expect(c.get('connect-src')).toEqual(["'self'", 'https://*.supabase.co', 'wss://*.supabase.co'])
    expect(c.has('upgrade-insecure-requests')).toBe(true)
  })
  it('HSTS, nosniff, anti-clickjacking, referrer e permissões', () => {
    expect(header('Strict-Transport-Security')).toMatch(/max-age=\d{8,}/)
    expect(header('X-Content-Type-Options')).toBe('nosniff')
    expect(header('X-Frame-Options')).toBe('DENY')
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(header('Permissions-Policy')).toMatch(/camera=\(\)/)
  })
  it('index.html compatível com a CSP: sem script inline e sem atributos style', () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    expect(scripts.length).toBeGreaterThan(0)
    for (const [, attrs, body] of scripts) {
      expect(attrs).toMatch(/\bsrc=/)
      expect(body!.trim()).toBe('')
    }
    expect(html).not.toMatch(/\sstyle=/)
    expect(html).not.toMatch(/\son[a-z]+=/i)
    expect(existsSync(resolve(root, 'public/boot-guard.js'))).toBe(true)
  })
})
