import { describe, expect, it, vi } from 'vitest'
import { resolvePage } from './resolve'
import { cityMeta, clip, matchRoute, robotsTxt, sitemapXml } from './seo'

describe('rotas para SEO', () => {
  it('classifica públicas, privadas, sem indexação e inexistentes', () => {
    expect(matchRoute('/')).toEqual({ kind: 'static', path: '/' })
    expect(matchRoute('/restaurantes/')).toEqual({ kind: 'static', path: '/restaurantes' })
    expect(matchRoute('/lojas/boa-vista')).toEqual({ kind: 'business', section: 'lojas', slug: 'boa-vista' })
    expect(matchRoute('/cidades/passos-mg/restaurantes')).toEqual({ kind: 'city', slug: 'passos-mg', section: 'restaurantes' })
    expect(matchRoute('/vagas/11111111-2222-3333-4444-555555555555').kind).toBe('job')
    for (const p of ['/entrar', '/admin/equipe', '/painel/x/pedidos', '/entregador', '/pedidos/1', '/sacola/checkout', '/vagas/minhas-candidaturas', '/conta'])
      expect(matchRoute(p).kind).toBe('private')
    expect(matchRoute('/entregadores').kind).toBe('static') // página pública de cadastro, não a área do entregador
    expect(matchRoute('/conectuai/u/ana').kind).toBe('noindex')
    expect(matchRoute('/Restaurantes/X').kind).toBe('notfound')
    expect(matchRoute('/qualquer').kind).toBe('notfound')
  })
})

describe('títulos e descrições', () => {
  it('cidade só promete o que existe', () => {
    const c = { name: 'Passos', state: 'MG', slug: 'passos-mg', restaurantes: 2, lojas: 0, servicos: 1, vagas: 0 }
    expect(cityMeta(c, null)).toMatchObject({ title: 'Delivery e Serviços em Passos, MG | Tucaí', index: true, canonicalPath: '/cidades/passos-mg' })
    expect(cityMeta(c, 'lojas')).toMatchObject({ title: 'Lojas em Passos, MG | Tucaí', index: false })
    expect(cityMeta({ ...c, restaurantes: 0, servicos: 0 }, null)).toMatchObject({ index: false })
  })
  it('descrição cortada em palavra inteira', () => {
    const d = clip('palavra '.repeat(40))
    expect(d.length).toBeLessThanOrEqual(155)
    expect(d.endsWith('…')).toBe(true)
  })
  it('resolve com dados do banco, redireciona tipo errado e trata banco indisponível', async () => {
    const rpc = vi.fn(async (fn: string) =>
      fn === 'seo_business' ? [{ name: 'Lanche Bom', business_type: 'restaurante', description: null, city_name: 'Passos', city_state: 'MG', indexable: true }] : null,
    ) as never
    await expect(resolvePage('/restaurantes/lanche-bom', rpc)).resolves.toMatchObject({ meta: { title: 'Lanche Bom em Passos, MG | Tucaí', index: true, canonicalPath: '/restaurantes/lanche-bom' } })
    await expect(resolvePage('/lojas/lanche-bom', rpc)).resolves.toMatchObject({ redirect: '/restaurantes/lanche-bom' })
    const down = (async () => null) as never
    await expect(resolvePage('/lojas/x', down)).resolves.toMatchObject({ meta: { index: false, status: 200 } })
    await expect(resolvePage('/nada', down)).resolves.toMatchObject({ meta: { status: 404 } })
  })
})

describe('robots.txt e sitemap.xml', () => {
  it('robots aponta o sitemap, bloqueia áreas privadas sem bloquear vizinhas e homologação não indexa', () => {
    const r = robotsTxt('https://x.example', true)
    expect(r).toContain('Sitemap: https://x.example/sitemap.xml')
    expect(r).toContain('Disallow: /entregador$')
    expect(r).toContain('Disallow: /entregador/')
    expect(r).not.toMatch(/^Disallow: \/entregador$/m)
    expect(r).not.toMatch(/Disallow: \/assets|\.js|\.css/)
    expect(robotsTxt('https://x.example', false)).toContain('Disallow: /\n')
  })
  it('sitemap com URLs absolutas, datas reais, sem duplicadas e com escape', () => {
    const xml = sitemapXml('https://x.example', [
      { path: '/restaurantes/a&b', lastmod: '2026-11-10T12:00:00Z' },
      { path: '/', lastmod: null },
      { path: '/restaurantes/a&b', lastmod: '2026-11-10T12:00:00Z' },
    ])
    expect(xml).toContain('<loc>https://x.example/restaurantes/a&amp;b</loc><lastmod>2026-11-10</lastmod>')
    expect(xml.match(/<loc>https:\/\/x\.example\/<\/loc>/g)).toHaveLength(1)
    expect(xml.match(/a&amp;b/g)).toHaveLength(1)
    expect(xml).not.toMatch(/entrar|admin|painel|sacola|conectuai/)
  })
})
