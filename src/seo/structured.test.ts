import { describe, expect, it } from 'vitest'
import { resolvePage } from './resolve'
import { businessLd, jobLd, ldScript, websiteLd } from './structured'

describe('dados estruturados', () => {
  it('estabelecimento: tipo certo, só campos reais, sem avaliação/preço/horário inventados', () => {
    const ld = businessLd({ name: 'Lanche Bom', businessType: 'restaurante', description: null, url: 'https://x/restaurantes/lb', addressLine: null, cityName: 'Passos', cityState: 'MG', phone: null, image: 'http://inseguro/img.png' })
    expect(ld).toEqual({
      '@context': 'https://schema.org', '@type': 'Restaurant', name: 'Lanche Bom', url: 'https://x/restaurantes/lb',
      address: { '@type': 'PostalAddress', addressLocality: 'Passos', addressRegion: 'MG', addressCountry: 'BR' },
    })
    expect(JSON.stringify(ld)).not.toMatch(/aggregateRating|review|priceRange|openingHours/)
    expect(businessLd({ name: 'L', businessType: 'loja', description: 'd', url: 'u', addressLine: 'Rua A, 1', cityName: null, cityState: null, phone: '35', image: null })['@type']).toBe('Store')
  })
  it('vaga: tipo de contratação mapeado, sem salário (período desconhecido), remoto com país', () => {
    const base = { title: 'Garçom', description: 'Atendimento', employmentType: 'clt', workMode: 'presencial', datePosted: '2026-11-01T10:00:00Z', validThrough: '2026-12-01T10:00:00Z', businessName: 'Lanche Bom', businessUrl: 'https://x/restaurantes/lb', cityName: 'Passos', cityState: 'MG', addressLine: null }
    const ld = jobLd(base)
    expect(ld).toMatchObject({ '@type': 'JobPosting', employmentType: 'FULL_TIME', datePosted: '2026-11-01', directApply: true, jobLocation: { address: { addressLocality: 'Passos' } } })
    expect(ld).not.toHaveProperty('baseSalary')
    expect(jobLd({ ...base, workMode: 'remoto' })).toMatchObject({ jobLocationType: 'TELECOMMUTE', applicantLocationRequirements: { name: 'BR' } })
  })
  it('JSON-LD não permite fechar a tag script', () => {
    const s = ldScript({ name: '</script><script>alert(1)</script>' })
    expect(s).not.toContain('</script><script>')
    expect(JSON.parse(s.replace(/^<script[^>]*>|<\/script>$/g, ''))).toEqual({ name: '</script><script>alert(1)</script>' })
  })
  it('home tem Organization e WebSite com busca; estabelecimento de teste sem JSON-LD', async () => {
    const home = await resolvePage('/', (async () => null) as never, 'https://x')
    expect(home.meta.jsonLd?.map((o) => o['@type'])).toEqual(['Organization', 'WebSite'])
    expect(websiteLd('https://x')).toMatchObject({ potentialAction: { target: { urlTemplate: 'https://x/busca?q={search_term_string}' } } })
    const rpc = (async () => [{ name: '[Teste] X', business_type: 'loja', description: null, city_name: null, city_state: null, city_slug: null, indexable: false, address_line: null, phone: null, logo_url: null, cover_url: null }]) as never
    const t = await resolvePage('/lojas/teste-x', rpc, 'https://x')
    expect(t.meta.index).toBe(false)
    expect(t.meta.jsonLd).toBeUndefined()
    expect(t.meta.shell?.heading).toBe('[Teste] X')
  })
})
