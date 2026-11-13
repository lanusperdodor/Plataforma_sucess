import { z } from 'zod'
import { RepositoryError, backendUnavailable, mapPostgrestError } from '../../lib/errors'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { mediaForPosts, type PostMedia } from '../media/repository'

/**
 * Conectuaí (0008). Leitura e escrita direto nas tabelas, sob RLS e gatilhos que validam
 * autoria, visibilidade, bloqueios, suspensão e limites. Nenhum dado é simulado.
 */

type Res = { data: unknown; error: { code?: string; message: string } | null; count?: number | null }

async function exec<T>(q: PromiseLike<Res>, schema: z.ZodType<T>): Promise<T> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  let res: Res
  try {
    res = await q
  } catch (e) {
    throw mapPostgrestError({ message: e instanceof Error ? e.message : String(e) })
  }
  if (res.error) throw mapPostgrestError(res.error)
  const parsed = schema.safeParse(res.data)
  if (!parsed.success) throw new RepositoryError('validation', 'Recebemos dados inesperados do servidor.', undefined, { cause: parsed.error })
  return parsed.data
}

async function count(q: PromiseLike<Res>): Promise<number> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  const res = await q
  if (res.error) throw mapPostgrestError(res.error)
  return res.count ?? 0
}

const ids = z.array(z.object({ id: z.string() }))
function one(rows: { id: string }[], msg = 'Você não tem permissão para esta ação.'): void {
  if (rows.length === 0) throw new RepositoryError('forbidden', msg)
}

export const PAGE = 20

// ---------- perfis ----------
const profileSchema = z
  .object({
    user_id: z.string(),
    handle: z.string(),
    display_name: z.string(),
    bio: z.string().nullable(),
    avatar_url: z.string().nullable(),
    city_id: z.string().nullable(),
    is_public: z.boolean(),
    created_at: z.string(),
    wall_enabled: z.boolean().optional(),
    wall_audience: z.enum(['everyone', 'friends']).optional(),
    show_connections: z.boolean().optional(),
    testimonials_enabled: z.boolean().optional(),
  })
  .transform((r) => ({
    userId: r.user_id,
    handle: r.handle,
    displayName: r.display_name,
    bio: r.bio,
    avatarUrl: r.avatar_url,
    cityId: r.city_id,
    isPublic: r.is_public,
    createdAt: r.created_at,
    wallEnabled: r.wall_enabled ?? true,
    wallAudience: r.wall_audience ?? 'everyone',
    showConnections: r.show_connections ?? true,
    testimonialsEnabled: r.testimonials_enabled ?? true,
  }))
export type SocialProfile = z.output<typeof profileSchema>
const PROFILE_COLS = 'user_id,handle,display_name,bio,avatar_url,city_id,is_public,created_at,wall_enabled,wall_audience,show_connections,testimonials_enabled'

export async function getProfileByUser(userId: string): Promise<SocialProfile | null> {
  return exec(supabase.from('social_profiles').select(PROFILE_COLS).eq('user_id', userId).maybeSingle(), profileSchema.nullable())
}

export async function getProfileByHandle(handle: string): Promise<SocialProfile | null> {
  return exec(supabase.from('social_profiles').select(PROFILE_COLS).eq('handle', handle.toLowerCase()).maybeSingle(), profileSchema.nullable())
}

export async function profilesByIds(userIds: string[]): Promise<Map<string, SocialProfile>> {
  const unique = [...new Set(userIds)].filter(Boolean)
  if (unique.length === 0) return new Map()
  const rows = await exec(supabase.from('social_profiles').select(PROFILE_COLS).in('user_id', unique), z.array(profileSchema))
  return new Map(rows.map((p) => [p.userId, p]))
}

export const profileFormSchema = z.object({
  handle: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,30}$/, 'Use de 3 a 30 letras minúsculas, números ou _.'),
  displayName: z.string().trim().min(2, 'Informe um nome de exibição.').max(60, 'Máximo de 60 caracteres.'),
  bio: z.string().trim().max(300, 'Máximo de 300 caracteres.'),
  avatarUrl: z.string().trim().refine((v) => v === '' || /^https:\/\/[^\s<>"']+$/.test(v), 'Use um endereço https://'),
  cityId: z.string(),
  isPublic: z.boolean(),
  wallEnabled: z.boolean().default(true),
  wallAudience: z.enum(['everyone', 'friends']).default('everyone'),
  showConnections: z.boolean().default(true),
  testimonialsEnabled: z.boolean().default(true),
})
export type ProfileForm = z.input<typeof profileFormSchema>

export async function saveMyProfile(userId: string, input: ProfileForm, exists: boolean): Promise<void> {
  const v = profileFormSchema.parse(input)
  const row = {
    handle: v.handle,
    display_name: v.displayName,
    bio: v.bio || null,
    avatar_url: v.avatarUrl || null,
    city_id: v.cityId || null,
    is_public: v.isPublic,
    wall_enabled: v.wallEnabled,
    wall_audience: v.wallAudience,
    show_connections: v.showConnections,
    testimonials_enabled: v.testimonialsEnabled,
  }
  if (exists) {
    const rows = await exec(supabase.from('social_profiles').update(row).eq('user_id', userId).select('user_id'), z.array(z.object({ user_id: z.string() })))
    if (rows.length === 0) throw new RepositoryError('forbidden', 'Você não tem permissão para esta ação.')
  } else {
    await exec(supabase.from('social_profiles').insert({ user_id: userId, ...row }).select('user_id'), z.array(z.object({ user_id: z.string() })))
  }
}

// ---------- publicações ----------
const postRowSchema = z.object({
  id: z.string(),
  author_id: z.string(),
  business_id: z.string().nullable(),
  product_id: z.string().nullable(),
  city_id: z.string().nullable(),
  shared_post_id: z.string().nullable(),
  body: z.string(),
  is_sponsored: z.boolean(),
  status: z.enum(['published', 'hidden']),
  like_count: z.number().int(),
  comment_count: z.number().int(),
  created_at: z.string(),
  edited_at: z.string().nullable(),
})
type PostRow = z.infer<typeof postRowSchema>
const POST_COLS = 'id,author_id,business_id,product_id,city_id,shared_post_id,body,is_sponsored,status,like_count,comment_count,created_at,edited_at'

export interface PostBusiness { id: string; name: string; slug: string; businessType: 'restaurante' | 'loja' | 'servico'; logoUrl: string | null }
export interface PostProduct { id: string; name: string; priceCents: number; isAvailable: boolean }
export interface Post {
  id: string
  author: SocialProfile | null
  authorId: string
  business: PostBusiness | null
  product: PostProduct | null
  shared: Omit<Post, 'shared'> | null
  sharedUnavailable: boolean
  body: string
  isSponsored: boolean
  hidden: boolean
  likeCount: number
  commentCount: number
  createdAt: string
  editedAt: string | null
  likedByMe: boolean
  savedByMe: boolean
  /** fotos ou vídeo (0045) */
  media: PostMedia[]
}

const businessSchema = z.object({ id: z.string(), name: z.string(), slug: z.string(), business_type: z.enum(['restaurante', 'loja', 'servico']), logo_url: z.string().nullable() })
const productSchema = z.object({ id: z.string(), name: z.string(), price_cents: z.number().int(), is_available: z.boolean() })

/** Junta autores, estabelecimentos, produtos, compartilhadas e o estado do usuário. */
async function enrich(rows: PostRow[], me: string | null): Promise<Post[]> {
  if (rows.length === 0) return []
  const sharedIds = [...new Set(rows.map((r) => r.shared_post_id).filter((x): x is string => !!x))]
  const shared = sharedIds.length ? await exec(supabase.from('posts').select(POST_COLS).in('id', sharedIds), z.array(postRowSchema)) : []
  const all = [...rows, ...shared]
  const bizIds = [...new Set(all.map((r) => r.business_id).filter((x): x is string => !!x))]
  const prodIds = [...new Set(all.map((r) => r.product_id).filter((x): x is string => !!x))]
  const postIds = rows.map((r) => r.id)
  const [profiles, businesses, products, liked, saved, media] = await Promise.all([
    profilesByIds(all.map((r) => r.author_id)),
    bizIds.length ? exec(supabase.from('public_businesses').select('id,name,slug,business_type,logo_url').in('id', bizIds), z.array(businessSchema)) : Promise.resolve([]),
    prodIds.length ? exec(supabase.from('products').select('id,name,price_cents,is_available').in('id', prodIds), z.array(productSchema)) : Promise.resolve([]),
    me ? exec(supabase.from('post_likes').select('post_id').eq('user_id', me).in('post_id', postIds), z.array(z.object({ post_id: z.string() }))) : Promise.resolve([]),
    me ? exec(supabase.from('post_saves').select('post_id').eq('user_id', me).in('post_id', postIds), z.array(z.object({ post_id: z.string() }))) : Promise.resolve([]),
    mediaForPosts(all.map((r) => r.id)),
  ])
  const biz = new Map(businesses.map((b) => [b.id, { id: b.id, name: b.name, slug: b.slug, businessType: b.business_type, logoUrl: b.logo_url }]))
  const prod = new Map(products.map((p) => [p.id, { id: p.id, name: p.name, priceCents: p.price_cents, isAvailable: p.is_available }]))
  const likedSet = new Set(liked.map((l) => l.post_id))
  const savedSet = new Set(saved.map((s) => s.post_id))
  const base = (r: PostRow): Omit<Post, 'shared' | 'sharedUnavailable'> => ({
    id: r.id,
    author: profiles.get(r.author_id) ?? null,
    authorId: r.author_id,
    business: r.business_id ? biz.get(r.business_id) ?? null : null,
    product: r.product_id ? prod.get(r.product_id) ?? null : null,
    body: r.body,
    isSponsored: r.is_sponsored,
    hidden: r.status === 'hidden',
    likeCount: r.like_count,
    commentCount: r.comment_count,
    createdAt: r.created_at,
    editedAt: r.edited_at,
    likedByMe: likedSet.has(r.id),
    savedByMe: savedSet.has(r.id),
    media: media.get(r.id) ?? [],
  })
  const sharedMap = new Map(shared.map((s) => [s.id, s]))
  return rows.map((r) => {
    const s = r.shared_post_id ? sharedMap.get(r.shared_post_id) : undefined
    return {
      ...base(r),
      shared: s ? { ...base(s), sharedUnavailable: false } : null,
      sharedUnavailable: !!r.shared_post_id && !s,
    }
  })
}

export type FeedScope = { kind: 'city'; cityId: string | null } | { kind: 'following' } | { kind: 'saved' } | { kind: 'author'; userId: string } | { kind: 'business'; businessId: string }

/** Página do feed com cursor por data (mais recentes primeiro). */
export async function listFeed(scope: FeedScope, me: string | null, before: string | null = null): Promise<{ posts: Post[]; nextCursor: string | null }> {
  let q = supabase.from('posts').select(POST_COLS)
  if (scope.kind === 'city') {
    if (scope.cityId) q = q.eq('city_id', scope.cityId)
  } else if (scope.kind === 'author') {
    q = q.eq('author_id', scope.userId)
  } else if (scope.kind === 'business') {
    q = q.eq('business_id', scope.businessId)
  } else {
    if (!me) return { posts: [], nextCursor: null }
    const table = scope.kind === 'following' ? 'follows' : 'post_saves'
    const col = scope.kind === 'following' ? 'followee_id' : 'post_id'
    const owner = scope.kind === 'following' ? 'follower_id' : 'user_id'
    let lq = supabase.from(table).select(col).eq(owner, me)
    if (scope.kind === 'following') lq = lq.eq('status', 'accepted')
    const links = await exec(lq, z.array(z.record(z.string(), z.string())))
    const list = links.map((l) => l[col]!).filter(Boolean)
    if (list.length === 0) return { posts: [], nextCursor: null }
    q = scope.kind === 'following' ? q.in('author_id', list) : q.in('id', list)
  }
  if (before) q = q.lt('created_at', before)
  const rows = await exec(q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE), z.array(postRowSchema))
  const posts = await enrich(rows, me)
  return { posts, nextCursor: rows.length === PAGE ? rows[rows.length - 1]!.created_at : null }
}

export async function getPost(id: string, me: string | null): Promise<Post | null> {
  const rows = await exec(supabase.from('posts').select(POST_COLS).eq('id', id), z.array(postRowSchema))
  return (await enrich(rows, me))[0] ?? null
}

/** Publicações por id, na ordem pedida (usado pelos patrocinados do feed). */
export async function getPostsByIds(ids: string[], me: string | null): Promise<Post[]> {
  if (ids.length === 0) return []
  const rows = await exec(supabase.from('posts').select(POST_COLS).in('id', ids).eq('status', 'published'), z.array(postRowSchema))
  const posts = await enrich(rows, me)
  return ids.map((id) => posts.find((p) => p.id === id)).filter((p): p is Post => !!p)
}

export const postInputSchema = z.object({
  body: z.string().trim().min(1, 'Escreva algo para publicar.').max(2000, 'Máximo de 2000 caracteres.'),
  cityId: z.string().nullable(),
  businessId: z.string().nullable(),
  productId: z.string().nullable(),
  sharedPostId: z.string().nullable(),
})
export type PostInput = z.input<typeof postInputSchema>

export async function createPost(input: PostInput): Promise<string> {
  const v = postInputSchema.parse(input)
  const rows = await exec(
    supabase
      .from('posts')
      .insert({ body: v.body, city_id: v.cityId, business_id: v.businessId, product_id: v.businessId ? v.productId : null, shared_post_id: v.sharedPostId })
      .select('id'),
    ids,
  )
  return rows[0]!.id
}

export async function updatePost(id: string, body: string): Promise<void> {
  const b = postInputSchema.shape.body.parse(body)
  one(await exec(supabase.from('posts').update({ body: b }).eq('id', id).select('id'), ids))
}

export async function deletePost(id: string): Promise<void> {
  one(await exec(supabase.from('posts').delete().eq('id', id).select('id'), ids))
}

export async function setLike(postId: string, liked: boolean, me: string): Promise<void> {
  if (liked) await exec(supabase.from('post_likes').insert({ post_id: postId }).select('post_id'), z.array(z.object({ post_id: z.string() })))
  else await exec(supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', me).select('post_id'), z.array(z.object({ post_id: z.string() })))
}

export async function setSave(postId: string, saved: boolean, me: string): Promise<void> {
  if (saved) await exec(supabase.from('post_saves').insert({ post_id: postId }).select('post_id'), z.array(z.object({ post_id: z.string() })))
  else await exec(supabase.from('post_saves').delete().eq('post_id', postId).eq('user_id', me).select('post_id'), z.array(z.object({ post_id: z.string() })))
}

// ---------- comentários ----------
const commentSchema = z.object({
  id: z.string(),
  post_id: z.string(),
  author_id: z.string(),
  parent_id: z.string().nullable(),
  body: z.string(),
  status: z.enum(['published', 'hidden']),
  created_at: z.string(),
  edited_at: z.string().nullable(),
})
export interface Comment { id: string; authorId: string; author: SocialProfile | null; parentId: string | null; body: string; hidden: boolean; createdAt: string; editedAt: string | null }

export async function listComments(postId: string): Promise<Comment[]> {
  const rows = await exec(
    supabase.from('post_comments').select('id,post_id,author_id,parent_id,body,status,created_at,edited_at').eq('post_id', postId).order('created_at').limit(500),
    z.array(commentSchema),
  )
  const profiles = await profilesByIds(rows.map((r) => r.author_id))
  return rows.map((r) => ({ id: r.id, authorId: r.author_id, author: profiles.get(r.author_id) ?? null, parentId: r.parent_id, body: r.body, hidden: r.status === 'hidden', createdAt: r.created_at, editedAt: r.edited_at }))
}

const commentBody = z.string().trim().min(1, 'Escreva um comentário.').max(1000, 'Máximo de 1000 caracteres.')

export async function addComment(postId: string, body: string, parentId: string | null = null): Promise<void> {
  await exec(supabase.from('post_comments').insert({ post_id: postId, parent_id: parentId, body: commentBody.parse(body) }).select('id'), ids)
}

export async function deleteComment(id: string): Promise<void> {
  one(await exec(supabase.from('post_comments').delete().eq('id', id).select('id'), ids))
}

// ---------- conexões ----------
export async function getFollowState(me: string, target: string): Promise<{ following: boolean; pending: boolean; blocked: boolean }> {
  const [f, b] = await Promise.all([
    exec(supabase.from('follows').select('status').eq('follower_id', me).eq('followee_id', target), z.array(z.object({ status: z.enum(['accepted', 'pending']) }))),
    exec(supabase.from('user_blocks').select('blocked_id').eq('blocker_id', me).eq('blocked_id', target), z.array(z.object({ blocked_id: z.string() }))),
  ])
  return { following: f[0]?.status === 'accepted', pending: f[0]?.status === 'pending', blocked: b.length > 0 }
}

export async function getFollowCounts(userId: string): Promise<{ followers: number; following: number }> {
  const [followers, following] = await Promise.all([
    count(supabase.from('follows').select('follower_id', { count: 'exact', head: true }).eq('followee_id', userId).eq('status', 'accepted')),
    count(supabase.from('follows').select('followee_id', { count: 'exact', head: true }).eq('follower_id', userId).eq('status', 'accepted')),
  ])
  return { followers, following }
}

export async function setFollow(me: string, target: string, follow: boolean): Promise<void> {
  if (follow) await exec(supabase.from('follows').insert({ follower_id: me, followee_id: target }).select('followee_id'), z.array(z.object({ followee_id: z.string() })))
  else await exec(supabase.from('follows').delete().eq('follower_id', me).eq('followee_id', target).select('followee_id'), z.array(z.object({ followee_id: z.string() })))
}

/** Solicitações pendentes para o próprio perfil fechado. */
export async function listFollowRequests(me: string): Promise<SocialProfile[]> {
  const rows = await exec(supabase.from('follows').select('follower_id').eq('followee_id', me).eq('status', 'pending'), z.array(z.object({ follower_id: z.string() })))
  const profiles = await profilesByIds(rows.map((r) => r.follower_id))
  return rows.map((r) => profiles.get(r.follower_id)).filter((p): p is SocialProfile => !!p)
}

export async function answerFollowRequest(me: string, follower: string, accept: boolean): Promise<void> {
  const q = accept
    ? supabase.from('follows').update({ status: 'accepted' }).eq('followee_id', me).eq('follower_id', follower).select('follower_id')
    : supabase.from('follows').delete().eq('followee_id', me).eq('follower_id', follower).select('follower_id')
  const rows = await exec(q, z.array(z.object({ follower_id: z.string() })))
  if (rows.length === 0) throw new RepositoryError('not_found', 'Solicitação não encontrada.')
}

export async function setBlock(me: string, target: string, block: boolean): Promise<void> {
  if (block) await exec(supabase.from('user_blocks').insert({ blocker_id: me, blocked_id: target }).select('blocked_id'), z.array(z.object({ blocked_id: z.string() })))
  else await exec(supabase.from('user_blocks').delete().eq('blocker_id', me).eq('blocked_id', target).select('blocked_id'), z.array(z.object({ blocked_id: z.string() })))
}

export async function isFollowingBusiness(me: string, businessId: string): Promise<boolean> {
  const rows = await exec(supabase.from('business_follows').select('business_id').eq('user_id', me).eq('business_id', businessId), z.array(z.object({ business_id: z.string() })))
  return rows.length > 0
}

export async function setBusinessFollow(me: string, businessId: string, follow: boolean): Promise<void> {
  if (follow) await exec(supabase.from('business_follows').insert({ business_id: businessId }).select('business_id'), z.array(z.object({ business_id: z.string() })))
  else await exec(supabase.from('business_follows').delete().eq('user_id', me).eq('business_id', businessId).select('business_id'), z.array(z.object({ business_id: z.string() })))
}

// ---------- denúncia e contestação ----------
export const REPORT_REASONS = {
  spam: 'Spam ou publicação automatizada',
  harassment: 'Assédio ou ofensa pessoal',
  hate: 'Discriminação ou discurso de ódio',
  threat: 'Ameaça ou violência',
  sexual: 'Conteúdo sexual impróprio',
  false_info: 'Informação falsa que causa dano',
  other: 'Outro motivo',
} as const
export type ReportReason = keyof typeof REPORT_REASONS

export type ReportTarget = 'post' | 'comment' | 'profile' | 'community' | 'topic' | 'reply' | 'scrap' | 'testimonial'

export async function reportContent(type: ReportTarget, id: string, reason: ReportReason, details = ''): Promise<void> {
  if (details.length > 1000) throw new RepositoryError('validation', 'Máximo de 1000 caracteres.')
  await exec(supabase.rpc('report_content', { _target_type: type, _target_id: id, _reason: reason, _details: details.trim() || null }), z.string())
}

export async function appealModeration(type: 'post' | 'comment' | 'suspension', id: string, reason: string): Promise<void> {
  const r = z.string().trim().min(10, 'Explique em pelo menos 10 caracteres.').max(1000).parse(reason)
  await exec(supabase.rpc('appeal_moderation', { _target_type: type, _target_id: id, _reason: r }), z.string())
}

// ---------- notificações ----------
/**
 * Todos os tipos que o banco cria (restrição notifications_kind_check, 0022): Conectuaí, amizades e recados, comunidades,
 * pedidos, entregas, vagas e avisos operacionais. Um tipo novo e desconhecido não derruba a lista: é exibido pela mensagem.
 */
export const NOTIFICATION_KINDS = [
  'like', 'comment', 'reply', 'follow', 'moderation',
  'friend_request', 'friend_accept', 'scrap', 'testimonial', 'community_request', 'community_accept', 'topic_reply',
  'order_new', 'order_update', 'delivery_offer', 'job_application', 'job_update', 'ops_alert',
] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number] | 'outro'
const notificationSchema = z.object({
  id: z.string(),
  kind: z.string().transform((k): NotificationKind => ((NOTIFICATION_KINDS as readonly string[]).includes(k) ? (k as NotificationKind) : 'outro')),
  actor_id: z.string().nullable(),
  post_id: z.string().nullable(),
  comment_id: z.string().nullable(),
  link: z.string().nullable().optional(),
  message: z.string().nullable(),
  read_at: z.string().nullable(),
  created_at: z.string(),
})
export interface ConectaNotification {
  id: string; kind: NotificationKind; actor: SocialProfile | null; postId: string | null; link: string | null; message: string | null; read: boolean; createdAt: string
}

/** Só as notificações da própria conta (RLS no banco + filtro explícito). */
export async function listNotifications(me: string): Promise<ConectaNotification[]> {
  const rows = await exec(
    supabase.from('notifications').select('id,kind,actor_id,post_id,comment_id,link,message,read_at,created_at').eq('user_id', me).order('created_at', { ascending: false }).limit(50),
    z.array(notificationSchema),
  )
  const profiles = await profilesByIds(rows.map((r) => r.actor_id ?? '').filter(Boolean))
  return rows.map((r) => ({
    id: r.id, kind: r.kind, actor: r.actor_id ? profiles.get(r.actor_id) ?? null : null, postId: r.post_id, link: r.link ?? null,
    message: r.message, read: !!r.read_at, createdAt: r.created_at,
  }))
}

export async function countUnread(me: string): Promise<number> {
  return count(supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', me).is('read_at', null))
}

export async function markAllRead(me: string): Promise<void> {
  await exec(supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', me).is('read_at', null).select('id'), ids)
}

// ---------- moderação (Painel Master) ----------
const reportRowSchema = z
  .object({
    id: z.string(), target_type: z.enum(['post', 'comment', 'profile']), target_id: z.string(), reason: z.string(), details: z.string().nullable(),
    status: z.string(), created_at: z.string(), reporter_email: z.string().nullable(), content_body: z.string(), content_status: z.string(),
    author_id: z.string().nullable(), author_handle: z.string().nullable(), open_reports: z.coerce.number(),
  })
  .transform((r) => ({
    id: r.id, targetType: r.target_type, targetId: r.target_id, reason: r.reason, details: r.details, status: r.status, createdAt: r.created_at,
    reporterEmail: r.reporter_email, contentBody: r.content_body, contentStatus: r.content_status, authorId: r.author_id, authorHandle: r.author_handle, openReports: r.open_reports,
  }))
export type ModerationReport = z.output<typeof reportRowSchema>

export async function adminListReports(status: 'open' | 'actioned' | 'dismissed' | null): Promise<ModerationReport[]> {
  return exec(supabase.rpc('admin_list_reports', { _status: status }), z.array(reportRowSchema))
}

export async function adminModerate(reportId: string, action: 'dismiss' | 'hide', note: string): Promise<void> {
  await exec(supabase.rpc('admin_moderate', { _report: reportId, _action: action, _note: note.trim() || null }), z.any())
}

export async function adminSuspend(userId: string, days: number | null, note: string): Promise<void> {
  const until = days ? new Date(Date.now() + days * 86_400_000).toISOString() : null
  await exec(supabase.rpc('admin_suspend_user', { _user: userId, _until: until, _note: note.trim() || null }), z.any())
}

const appealRowSchema = z
  .object({ id: z.string(), author_id: z.string(), author_handle: z.string().nullable(), target_type: z.string(), target_id: z.string(), reason: z.string(), status: z.string(), content_body: z.string(), created_at: z.string() })
  .transform((r) => ({ id: r.id, authorHandle: r.author_handle, targetType: r.target_type, reason: r.reason, status: r.status, contentBody: r.content_body, createdAt: r.created_at }))
export type ModerationAppeal = z.output<typeof appealRowSchema>

export async function adminListAppeals(): Promise<ModerationAppeal[]> {
  return exec(supabase.rpc('admin_list_appeals', { _status: 'open' }), z.array(appealRowSchema))
}

export async function adminResolveAppeal(id: string, decision: 'uphold' | 'reverse', note: string): Promise<void> {
  await exec(supabase.rpc('admin_resolve_appeal', { _appeal: id, _decision: decision, _note: note.trim() || null }), z.any())
}
