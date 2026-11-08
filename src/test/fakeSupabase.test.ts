import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from './fakeSupabase.ts'

describe('fakeSupabase', () => {
  it('registra a consulta encadeada e usa o handler', async () => {
    const fake = createFakeSupabase((q) => ({ data: [{ id: q.eq.id }], error: null }))
    const res = await fake.supabase
      .from('businesses')
      .select('id,name')
      .eq('id', 'x')
      .in('city', ['a'])
      .order('name', { ascending: false })
      .range(0, 9)
    expect(res.data).toEqual([{ id: 'x' }])
    expect(fake.queries[0]).toMatchObject({
      table: 'businesses',
      op: 'select',
      columns: 'id,name',
      order: [{ column: 'name', ascending: false }],
      range: { from: 0, to: 9 },
    })
  })

  it('distingue insert, rpc e maybeSingle', async () => {
    const fake = createFakeSupabase()
    await fake.supabase.from('orders').insert({ a: 1 }).select().single()
    await fake.supabase.rpc('fn', { p: 1 })
    await fake.supabase.from('t').select().maybeSingle()
    expect(fake.queries.map((q) => q.op)).toEqual(['insert', 'rpc', 'select'])
    expect(fake.queries[0]).toMatchObject({ payload: { a: 1 }, single: 'single' })
    expect(fake.queries[2]?.single).toBe('maybeSingle')
  })
})
