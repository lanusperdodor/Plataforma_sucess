import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FakeSupabase } from '../../test/fakeSupabase'

const h = vi.hoisted(() => ({ fake: null as unknown as FakeSupabase }))
vi.mock('../../lib/supabase', async () => {
  const { createFakeSupabase } = await import('../../test/fakeSupabase')
  h.fake = createFakeSupabase()
  return { isSupabaseConfigured: true, supabase: h.fake.supabase }
})
const repo = await import('./repository')
afterEach(() => h.fake.reset())

const store = {
  description: ' Lanches ', phone: '', whatsapp: '(35) 99999-0000', addressLine: '', coverUrl: '', logoUrl: 'https://cdn.example/logo.png',
  categoryId: '', deliveryOffer: 'own' as const, ownDeliveryFee: '5,00', acceptsPickup: true, minOrder: '20', estimatedMin: '30', estimatedMax: '45',
}
const product = { categoryId: 'c1', name: ' X-Burger ', description: '', price: '24,90', imageUrl: '', isAvailable: true }

describe('painel do estabelecimento — validação', () => {
  it('converte o formulário da loja em centavos e nulos', () => {
    expect(repo.storeFormToPatch(store)).toMatchObject({
      description: 'Lanches', phone: null, whatsapp: '(35) 99999-0000', logo_url: 'https://cdn.example/logo.png', category_id: null,
      delivery_offer: 'own', own_delivery_fee_cents: 500, min_order_cents: 2000, estimated_min_minutes: 30, estimated_max_minutes: 45,
    })
    expect(repo.storeFormToPatch({ ...store, deliveryOffer: 'none' }).own_delivery_fee_cents).toBe(0)
  })
  it('recusa URL não https, tempos invertidos, valores inválidos e loja sem entrega nem retirada', () => {
    expect(repo.storeFormSchema.safeParse({ ...store, logoUrl: 'javascript:alert(1)' }).success).toBe(false)
    expect(repo.storeFormSchema.safeParse({ ...store, coverUrl: 'http://x.example/a.png' }).success).toBe(false)
    expect(repo.storeFormSchema.safeParse({ ...store, estimatedMin: '50', estimatedMax: '40' }).success).toBe(false)
    expect(repo.storeFormSchema.safeParse({ ...store, ownDeliveryFee: 'cinco' }).success).toBe(false)
    expect(repo.storeFormSchema.safeParse({ ...store, deliveryOffer: 'none', acceptsPickup: false }).success).toBe(false)
  })
  it('produto: preço em reais vira centavos; preço inválido ou absurdo é recusado', () => {
    expect(repo.productFormToRow(product)).toEqual({ category_id: 'c1', name: 'X-Burger', description: null, price_cents: 2490, image_url: null, is_available: true })
    expect(repo.productFormSchema.safeParse({ ...product, price: '-5' }).success).toBe(false)
    expect(repo.productFormSchema.safeParse({ ...product, price: '200.000,00' }).success).toBe(false)
    expect(repo.productFormSchema.safeParse({ ...product, name: '' }).success).toBe(false)
  })
})

describe('painel do estabelecimento — servidor', () => {
  it('escrita filtrada pela RLS (0 linhas) vira erro de permissão, nunca sucesso silencioso', async () => {
    h.fake.handler = () => ({ data: [], error: null })
    await expect(repo.updateProduct('p1', product)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(repo.deleteProduct('p1')).rejects.toMatchObject({ code: 'forbidden' })
  })
  it('lista negócios pelo vínculo no banco', async () => {
    h.fake.handler = (q) => (q.table === 'business_members' ? { data: [{ business_id: 'b1' }], error: null } : { data: [], error: null })
    await repo.listMyBusinesses('u1')
    expect(h.fake.queries[0]).toMatchObject({ table: 'business_members', eq: { user_id: 'u1' } })
    expect(h.fake.queries[1]!.table).toBe('businesses')
    expect(h.fake.queries[1]!.filters).toContainEqual({ kind: 'in', column: 'id', value: ['b1'] })
  })
  it('cria produto com o business_id do painel', async () => {
    h.fake.handler = () => ({ data: [{ id: 'p1' }], error: null })
    await repo.createProduct('b1', product)
    expect(h.fake.queries[0]).toMatchObject({ table: 'products', op: 'insert', payload: { business_id: 'b1', price_cents: 2490 } })
  })
})
