import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FakeSupabase } from '../../test/fakeSupabase'

const h = vi.hoisted(() => ({ fake: null as unknown as FakeSupabase }))
vi.mock('../../lib/supabase', async () => {
  const { createFakeSupabase } = await import('../../test/fakeSupabase')
  h.fake = createFakeSupabase()
  return { isSupabaseConfigured: true, supabase: h.fake.supabase }
})
const repo = await import('./repository')
const page = await import('../../pages/NotificationsPage')

afterEach(() => h.fake.reset())
const row = (kind: string, extra: Record<string, unknown> = {}) => ({
  id: `n-${kind}`, kind, actor_id: null, post_id: null, comment_id: null, link: null, message: `msg ${kind}`, read_at: null, created_at: '2026-11-13T12:00:00Z', ...extra,
})

describe('notificações (causa do erro "dados inesperados")', () => {
  it('aceita TODOS os tipos que o banco cria — antes só 5 eram aceitos e um aviso de pedido derrubava a lista', async () => {
    h.fake.handler = (q) => (q.table === 'notifications' ? { data: repo.NOTIFICATION_KINDS.map((k) => row(k)), error: null } : { data: [], error: null })
    const list = await repo.listNotifications('u1')
    expect(list.map((n) => n.kind)).toEqual([...repo.NOTIFICATION_KINDS])
    // só as notificações da própria conta: filtro explícito além da RLS
    const q = h.fake.queries.find((x) => x.table === 'notifications')!
    expect(q.filters).toContainEqual({ kind: 'eq', column: 'user_id', value: 'u1' })
  })

  it('tipo desconhecido no futuro não derruba a lista: aparece pela mensagem', async () => {
    h.fake.handler = (q) => (q.table === 'notifications' ? { data: [row('novo_tipo_futuro', { message: 'Aviso novo' })], error: null } : { data: [], error: null })
    const [n] = await repo.listNotifications('u1')
    expect(n!.kind).toBe('outro')
    expect(page.notificationText(n!)).toBe('Aviso novo')
  })

  it('cada tipo leva ao lugar certo, priorizando o link gravado pelo banco', () => {
    const base = { id: '1', actor: null, postId: null, message: null, read: false, createdAt: '' }
    expect(page.notificationHref({ ...base, kind: 'order_update', link: '/pedidos/abc' })).toBe('/pedidos/abc')
    expect(page.notificationHref({ ...base, kind: 'ops_alert', link: '/entregador/saques' })).toBe('/entregador/saques')
    expect(page.notificationHref({ ...base, kind: 'friend_request', link: null })).toBe('/conectuai/amigos')
    expect(page.notificationHref({ ...base, kind: 'order_new', link: null })).toBe('/pedidos')
    expect(page.notificationHref({ ...base, kind: 'like', link: null, postId: 'p1' })).toBe('/conectuai/p1')
    expect(page.notificationHref({ ...base, kind: 'scrap', link: 'https://malicioso.example' })).toBe('/conectuai')
  })

  it('marcar como lidas atualiza só as não lidas da própria conta', async () => {
    h.fake.handler = () => ({ data: [{ id: 'n1' }], error: null })
    await repo.markAllRead('u2')
    const q = h.fake.queries[0]!
    expect(q.filters).toEqual(expect.arrayContaining([{ kind: 'eq', column: 'user_id', value: 'u2' }, { kind: 'is', column: 'read_at', value: null }]))
  })
})
