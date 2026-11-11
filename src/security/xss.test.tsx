import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { BusinessCard } from '../components/cards/BusinessCard.tsx'
import { businessRowSchema } from '../features/catalog/schemas.ts'

afterEach(cleanup)

const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>'

describe('XSS: conteúdo de usuários é sempre texto', () => {
  it('nome e descrição maliciosos aparecem literais, sem criar elementos', () => {
    const b = businessRowSchema.parse({
      id: 'b1', name: payload, slug: 'x', business_type: 'restaurante', category_id: null, city_id: 'c1',
      description: payload, cover_url: null, logo_url: null, address_line: null, phone: null, whatsapp: null,
      lat: null, lng: null, distance_estimate_km: null, delivery_offer: 'none', own_delivery_fee_cents: 0,
      accepts_pickup: true, estimated_min_minutes: null, estimated_max_minutes: null, min_order_cents: 0,
      price_tier: null, rating_avg: 0, rating_count: 0, popularity_score: 0, is_featured: false, is_open: true,
    })
    const { container } = render(<MemoryRouter><BusinessCard business={b} /></MemoryRouter>)
    expect(screen.getByText(payload)).toBeInTheDocument()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img[onerror]')).toBeNull()
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
  })

  it('o código-fonte não usa renderização de HTML cru nem eval', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) files.push(p)
      }
    }
    walk(resolve(__dirname, '..'))
    const offenders = files.filter((f) => /dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\(|new Function\(|document\.write/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
