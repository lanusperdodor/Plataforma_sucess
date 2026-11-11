import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FakeQuery, FakeSupabase } from '../../test/fakeSupabase'

const h = vi.hoisted(() => ({ fake: null as unknown as FakeSupabase }))
vi.mock('../../lib/supabase', async () => {
  const { createFakeSupabase } = await import('../../test/fakeSupabase')
  h.fake = createFakeSupabase()
  return { isSupabaseConfigured: true, supabase: h.fake.supabase }
})
const repo = await import('./repository')
afterEach(() => h.fake.reset())

const post = (id: string, extra: Record<string, unknown> = {}) => ({
  id, author_id: 'u1', business_id: null, product_id: null, city_id: 'c1', shared_post_id: null, body: 'Olá', is_sponsored: false,
  status: 'published', like_count: 2, comment_count: 1, created_at: `2026-11-1${id.length}T10:00:00Z`, edited_at: null, ...extra,
})
const profile = { user_id: 'u1', handle: 'ana', display_name: 'Ana', bio: null, avatar_url: null, city_id: null, is_public: true, created_at: '2026-11-01T00:00:00Z' }

function route(q: FakeQuery) {
  if (q.table === 'posts') return { data: [post('p1')], error: null }
  if (q.table === 'social_profiles') return { data: [profile], error: null }
  if (q.table === 'post_likes') return { data: [{ post_id: 'p1' }], error: null }
  return { data: [], error: null }
}

describe('feed do Conectuaí', () => {
  it('feed da cidade filtra por cidade, ordena e junta autor e estado do usuário', async () => {
    h.fake.handler = route
    const { posts } = await repo.listFeed({ kind: 'city', cityId: 'c1' }, 'me')
    const q = h.fake.queries.find((x) => x.table === 'posts')!
    expect(q.eq).toMatchObject({ city_id: 'c1' })
    expect(q.order[0]).toEqual({ column: 'created_at', ascending: false })
    expect(posts[0]).toMatchObject({ id: 'p1', likedByMe: true, savedByMe: false, author: { handle: 'ana' }, likeCount: 2 })
  })
  it('cursor usa created_at estritamente anterior', async () => {
    h.fake.handler = route
    await repo.listFeed({ kind: 'city', cityId: null }, null, '2026-11-10T00:00:00Z')
    expect(h.fake.queries[0]!.filters).toContainEqual({ kind: 'lt', column: 'created_at', value: '2026-11-10T00:00:00Z' })
  })
  it('"Seguindo" sem seguidas aprovadas não consulta publicações', async () => {
    h.fake.handler = () => ({ data: [], error: null })
    await expect(repo.listFeed({ kind: 'following' }, 'me')).resolves.toEqual({ posts: [], nextCursor: null })
    expect(h.fake.queries.map((q) => q.table)).toEqual(['follows'])
    expect(h.fake.queries[0]!.eq).toMatchObject({ follower_id: 'me', status: 'accepted' })
  })
  it('publicação compartilhada indisponível (oculta/bloqueada) é sinalizada sem expor conteúdo', async () => {
    h.fake.handler = (q) => (q.table === 'posts' && q.filters.some((f) => f.kind === 'in') ? { data: [], error: null } : q.table === 'posts' ? { data: [post('p2', { shared_post_id: 'px' })], error: null } : route(q))
    const { posts } = await repo.listFeed({ kind: 'author', userId: 'u1' }, null)
    expect(posts[0]).toMatchObject({ shared: null, sharedUnavailable: true })
  })
})

describe('escrita no Conectuaí', () => {
  it('produto só acompanha publicação em nome de estabelecimento', async () => {
    h.fake.handler = () => ({ data: [{ id: 'n1' }], error: null })
    await repo.createPost({ body: ' Oi ', cityId: 'c1', businessId: null, productId: 'p9', sharedPostId: null })
    expect(h.fake.queries[0]!.payload).toEqual({ body: 'Oi', city_id: 'c1', business_id: null, product_id: null, shared_post_id: null })
  })
  it('valida texto, nome de usuário e foto antes de enviar', () => {
    expect(repo.postInputSchema.safeParse({ body: '   ', cityId: null, businessId: null, productId: null, sharedPostId: null }).success).toBe(false)
    expect(repo.profileFormSchema.safeParse({ handle: 'Ana Silva', displayName: 'Ana', bio: '', avatarUrl: '', cityId: '', isPublic: true }).success).toBe(false)
    expect(repo.profileFormSchema.safeParse({ handle: 'ana_silva', displayName: 'Ana', bio: '', avatarUrl: 'javascript:alert(1)', cityId: '', isPublic: true }).success).toBe(false)
    expect(repo.profileFormSchema.parse({ handle: 'Ana_Silva', displayName: 'Ana', bio: '', avatarUrl: '', cityId: '', isPublic: true }).handle).toBe('ana_silva')
  })
  it('editar/excluir filtrado pela RLS vira erro de permissão', async () => {
    h.fake.handler = () => ({ data: [], error: null })
    await expect(repo.updatePost('p1', 'novo')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(repo.deletePost('p1')).rejects.toMatchObject({ code: 'forbidden' })
  })
  it('descurtir apaga só a curtida do próprio usuário', async () => {
    h.fake.handler = () => ({ data: [], error: null })
    await repo.setLike('p1', false, 'me')
    expect(h.fake.queries[0]).toMatchObject({ table: 'post_likes', op: 'delete', eq: { post_id: 'p1', user_id: 'me' } })
  })
  it('limite de publicação (PT429) e regra do servidor chegam legíveis', async () => {
    h.fake.handler = () => ({ data: null, error: { code: 'PT429', message: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.' } })
    await expect(repo.createPost({ body: 'x', cityId: null, businessId: null, productId: null, sharedPostId: null })).rejects.toMatchObject({ code: 'rate_limited' })
    h.fake.handler = () => ({ data: null, error: { code: 'P0001', message: 'Você já denunciou este conteúdo; a denúncia está em análise.' } })
    await expect(repo.reportContent('post', 'p1', 'spam')).rejects.toMatchObject({ code: 'business_rule' })
  })
  it('contestação exige explicação mínima', async () => {
    await expect(repo.appealModeration('post', 'p1', 'curto')).rejects.toThrow()
    expect(h.fake.queries).toHaveLength(0)
  })
  it('não lidas contam só read_at nulo do próprio usuário', async () => {
    h.fake.handler = () => ({ data: null, error: null, count: 3 })
    await expect(repo.countUnread('me')).resolves.toBe(3)
    expect(h.fake.queries[0]!.filters).toContainEqual({ kind: 'is', column: 'read_at', value: null })
  })
})
