import { z } from 'zod'
import { RepositoryError, backendUnavailable, mapPostgrestError } from '../../lib/errors'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { profilesByIds, type SocialProfile } from '../conecta/repository'

/**
 * Conectuaí — amizades, recados, depoimentos, comunidades, tópicos e enquetes (0010).
 * Autoria, visibilidade, privacidade, bloqueios, limites e moderação são aplicados no banco.
 */

type Res = { data: unknown; error: { code?: string; message: string } | null }
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
const rows = <T extends z.ZodRawShape>(shape: T) => z.array(z.object(shape))
function atLeastOne(list: unknown[], msg = 'Você não tem permissão para esta ação.') {
  if (list.length === 0) throw new RepositoryError('forbidden', msg)
}

/** Ids entram em filtros or(...) do PostgREST: só UUIDs válidos (evita injeção no filtro). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function uuid(id: string): string {
  if (!UUID.test(id)) throw new RepositoryError('validation', 'Identificador inválido.')
  return id
}

// ---------- amizades ----------
export type FriendState = 'none' | 'friends' | 'sent' | 'received'

const friendRow = { requester_id: z.string(), addressee_id: z.string(), status: z.enum(['pending', 'accepted']) }

export async function getFriendState(me: string, other: string): Promise<FriendState> {
  const list = await exec(
    supabase.from('friendships').select('requester_id,addressee_id,status')
      .or(`and(requester_id.eq.${uuid(me)},addressee_id.eq.${uuid(other)}),and(requester_id.eq.${other},addressee_id.eq.${me})`),
    rows(friendRow),
  )
  const f = list[0]
  if (!f) return 'none'
  if (f.status === 'accepted') return 'friends'
  return f.requester_id === me ? 'sent' : 'received'
}

export async function sendFriendRequest(other: string): Promise<void> {
  await exec(supabase.from('friendships').insert({ addressee_id: other }).select('addressee_id'), rows({ addressee_id: z.string() }))
}

export async function acceptFriend(me: string, requester: string): Promise<void> {
  atLeastOne(await exec(supabase.from('friendships').update({ status: 'accepted' }).eq('addressee_id', me).eq('requester_id', requester).select('requester_id'), rows({ requester_id: z.string() })))
}

/** Desfaz amizade, cancela ou recusa convite (qualquer direção). */
export async function removeFriend(me: string, other: string): Promise<void> {
  await exec(
    supabase.from('friendships').delete()
      .or(`and(requester_id.eq.${uuid(me)},addressee_id.eq.${uuid(other)}),and(requester_id.eq.${other},addressee_id.eq.${me})`)
      .select('requester_id'),
    rows({ requester_id: z.string() }),
  )
}

export async function listFriends(userId: string): Promise<SocialProfile[]> {
  const list = await exec(
    supabase.from('friendships').select('requester_id,addressee_id,status').eq('status', 'accepted').or(`requester_id.eq.${uuid(userId)},addressee_id.eq.${userId}`).limit(500),
    rows(friendRow),
  )
  const ids = list.map((f) => (f.requester_id === userId ? f.addressee_id : f.requester_id))
  const profiles = await profilesByIds(ids)
  return ids.map((id) => profiles.get(id)).filter((p): p is SocialProfile => !!p).sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'))
}

export async function listFriendRequests(me: string): Promise<SocialProfile[]> {
  const list = await exec(supabase.from('friendships').select('requester_id,addressee_id,status').eq('addressee_id', me).eq('status', 'pending'), rows(friendRow))
  const profiles = await profilesByIds(list.map((f) => f.requester_id))
  return list.map((f) => profiles.get(f.requester_id)).filter((p): p is SocialProfile => !!p)
}

// ---------- recados ----------
export interface Scrap { id: string; ownerId: string; authorId: string; author: SocialProfile | null; parentId: string | null; body: string; hidden: boolean; createdAt: string }
const scrapRow = { id: z.string(), owner_id: z.string(), author_id: z.string(), parent_id: z.string().nullable(), body: z.string(), status: z.enum(['published', 'hidden']), created_at: z.string() }

export async function listScraps(ownerId: string): Promise<Scrap[]> {
  const list = await exec(
    supabase.from('scraps').select('id,owner_id,author_id,parent_id,body,status,created_at').eq('owner_id', ownerId).order('created_at', { ascending: false }).limit(100),
    rows(scrapRow),
  )
  const profiles = await profilesByIds(list.map((s) => s.author_id))
  return list.map((s) => ({ id: s.id, ownerId: s.owner_id, authorId: s.author_id, author: profiles.get(s.author_id) ?? null, parentId: s.parent_id, body: s.body, hidden: s.status === 'hidden', createdAt: s.created_at }))
}

export const scrapBody = z.string().trim().min(1, 'Escreva o recado.').max(1000, 'Máximo de 1000 caracteres.')

export async function addScrap(ownerId: string, body: string, parentId: string | null = null): Promise<void> {
  await exec(supabase.from('scraps').insert({ owner_id: ownerId, parent_id: parentId, body: scrapBody.parse(body) }).select('id'), rows({ id: z.string() }))
}

export async function deleteScrap(id: string): Promise<void> {
  atLeastOne(await exec(supabase.from('scraps').delete().eq('id', id).select('id'), rows({ id: z.string() })))
}

// ---------- depoimentos ----------
export interface Testimonial { id: string; recipientId: string; authorId: string; author: SocialProfile | null; body: string; status: 'pending' | 'approved' | 'rejected' | 'hidden'; createdAt: string }
const testimonialRow = { id: z.string(), recipient_id: z.string(), author_id: z.string(), body: z.string(), status: z.enum(['pending', 'approved', 'rejected', 'hidden']), created_at: z.string() }

export async function listTestimonials(recipientId: string): Promise<Testimonial[]> {
  const list = await exec(
    supabase.from('testimonials').select('id,recipient_id,author_id,body,status,created_at').eq('recipient_id', recipientId).order('created_at', { ascending: false }),
    rows(testimonialRow),
  )
  const profiles = await profilesByIds(list.map((t) => t.author_id))
  return list.map((t) => ({ id: t.id, recipientId: t.recipient_id, authorId: t.author_id, author: profiles.get(t.author_id) ?? null, body: t.body, status: t.status, createdAt: t.created_at }))
}

export const testimonialBody = z.string().trim().min(10, 'Escreva pelo menos 10 caracteres.').max(1000, 'Máximo de 1000 caracteres.')

export async function writeTestimonial(recipientId: string, body: string): Promise<void> {
  await exec(supabase.from('testimonials').insert({ recipient_id: recipientId, body: testimonialBody.parse(body) }).select('id'), rows({ id: z.string() }))
}

export async function decideTestimonial(id: string, approve: boolean): Promise<void> {
  atLeastOne(await exec(supabase.from('testimonials').update({ status: approve ? 'approved' : 'rejected' }).eq('id', id).select('id'), rows({ id: z.string() })))
}

export async function deleteTestimonial(id: string): Promise<void> {
  atLeastOne(await exec(supabase.from('testimonials').delete().eq('id', id).select('id'), rows({ id: z.string() })))
}

// ---------- comunidades ----------
export const COMMUNITY_CATEGORIES = {
  gastronomia: 'Gastronomia', comercio: 'Comércio local', promocoes: 'Promoções', empregos: 'Empregos e oportunidades',
  servicos: 'Serviços', esportes: 'Esportes', veiculos: 'Veículos', cultura: 'Cultura e eventos', educacao: 'Educação',
  bairro: 'Bairro', cidade: 'Cidade', outros: 'Outros',
} as const
export type CommunityCategory = keyof typeof COMMUNITY_CATEGORIES

const communityRow = z
  .object({
    id: z.string(), slug: z.string(), name: z.string(), description: z.string().nullable(), rules: z.string().nullable(),
    category: z.string(), city_id: z.string().nullable(), is_private: z.boolean(), avatar_url: z.string().nullable(),
    cover_url: z.string().nullable(), business_id: z.string().nullable(), owner_id: z.string(), status: z.string(),
    member_count: z.number().int(), created_at: z.string(),
  })
  .transform((r) => ({
    id: r.id, slug: r.slug, name: r.name, description: r.description, rules: r.rules, category: r.category as CommunityCategory,
    cityId: r.city_id, isPrivate: r.is_private, avatarUrl: r.avatar_url, coverUrl: r.cover_url, businessId: r.business_id,
    ownerId: r.owner_id, hidden: r.status === 'hidden', memberCount: r.member_count, createdAt: r.created_at,
  }))
export type Community = z.output<typeof communityRow>
const COMMUNITY_COLS = 'id,slug,name,description,rules,category,city_id,is_private,avatar_url,cover_url,business_id,owner_id,status,member_count,created_at'

export async function listCommunities(filters: { search?: string; category?: string; cityId?: string | null } = {}): Promise<Community[]> {
  let q = supabase.from('communities').select(COMMUNITY_COLS).eq('status', 'active')
  if (filters.category) q = q.eq('category', filters.category)
  if (filters.cityId) q = q.eq('city_id', filters.cityId)
  const term = filters.search?.trim().replace(/[%_,()]/g, '')
  if (term) q = q.ilike('name', `%${term}%`)
  return exec(q.order('member_count', { ascending: false }).limit(60), z.array(communityRow))
}

export async function getCommunity(slug: string): Promise<Community | null> {
  return exec(supabase.from('communities').select(COMMUNITY_COLS).eq('slug', slug).maybeSingle(), communityRow.nullable())
}

export async function myCommunities(userId: string): Promise<Community[]> {
  const links = await exec(supabase.from('community_members').select('community_id').eq('user_id', userId).eq('status', 'active'), rows({ community_id: z.string() }))
  if (links.length === 0) return []
  return exec(supabase.from('communities').select(COMMUNITY_COLS).in('id', links.map((l) => l.community_id)).order('name'), z.array(communityRow))
}

export const communityFormSchema = z.object({
  name: z.string().trim().min(3, 'Nome com pelo menos 3 caracteres.').max(80),
  description: z.string().trim().max(1000),
  rules: z.string().trim().max(3000),
  category: z.enum(Object.keys(COMMUNITY_CATEGORIES) as [CommunityCategory, ...CommunityCategory[]]),
  cityId: z.string(),
  isPrivate: z.boolean(),
  avatarUrl: z.string().trim().refine((v) => v === '' || /^https:\/\/[^\s<>"']+$/.test(v), 'Use um endereço https://'),
})
export type CommunityForm = z.input<typeof communityFormSchema>

export async function createCommunity(input: CommunityForm): Promise<string> {
  const v = communityFormSchema.parse(input)
  const created = await exec(
    supabase.from('communities').insert({
      name: v.name, description: v.description || null, rules: v.rules || null, category: v.category,
      city_id: v.cityId || null, is_private: v.isPrivate, avatar_url: v.avatarUrl || null,
    }).select('slug'),
    rows({ slug: z.string() }),
  )
  return created[0]!.slug
}

export async function updateCommunity(id: string, input: CommunityForm): Promise<void> {
  const v = communityFormSchema.parse(input)
  atLeastOne(await exec(
    supabase.from('communities').update({
      description: v.description || null, rules: v.rules || null, category: v.category, city_id: v.cityId || null,
      is_private: v.isPrivate, avatar_url: v.avatarUrl || null,
    }).eq('id', id).select('id'),
    rows({ id: z.string() }),
  ))
}

export type MemberRole = 'owner' | 'moderator' | 'member'
export type MemberStatus = 'active' | 'pending' | 'banned'
export interface Member { userId: string; profile: SocialProfile | null; role: MemberRole; status: MemberStatus; joinedAt: string }
const memberRow = { user_id: z.string(), role: z.enum(['owner', 'moderator', 'member']), status: z.enum(['active', 'pending', 'banned']), joined_at: z.string() }

export async function getMembership(communityId: string, me: string): Promise<{ role: MemberRole; status: MemberStatus } | null> {
  const list = await exec(supabase.from('community_members').select('user_id,role,status,joined_at').eq('community_id', communityId).eq('user_id', me), rows(memberRow))
  return list[0] ? { role: list[0].role, status: list[0].status } : null
}

export async function listMembers(communityId: string, status: MemberStatus = 'active'): Promise<Member[]> {
  const list = await exec(
    supabase.from('community_members').select('user_id,role,status,joined_at').eq('community_id', communityId).eq('status', status).order('joined_at').limit(300),
    rows(memberRow),
  )
  const profiles = await profilesByIds(list.map((m) => m.user_id))
  return list.map((m) => ({ userId: m.user_id, profile: profiles.get(m.user_id) ?? null, role: m.role, status: m.status, joinedAt: m.joined_at }))
}

export async function joinCommunity(communityId: string): Promise<void> {
  await exec(supabase.from('community_members').insert({ community_id: communityId }).select('community_id'), rows({ community_id: z.string() }))
}

export async function leaveCommunity(communityId: string, me: string): Promise<void> {
  atLeastOne(await exec(supabase.from('community_members').delete().eq('community_id', communityId).eq('user_id', me).select('community_id'), rows({ community_id: z.string() })),
    'Não foi possível sair: a dona precisa transferir a comunidade antes.')
}

export async function manageMember(communityId: string, userId: string, action: 'approve' | 'reject' | 'ban' | 'unban' | 'promote' | 'demote'): Promise<void> {
  await exec(supabase.rpc('community_manage_member', { _community: communityId, _user: userId, _action: action }), z.any())
}

// ---------- tópicos e respostas ----------
export interface Topic { id: string; communityId: string; authorId: string; author: SocialProfile | null; title: string; body: string; isPinned: boolean; isLocked: boolean; hidden: boolean; replyCount: number; lastActivityAt: string; createdAt: string; editedAt: string | null }
const topicRow = {
  id: z.string(), community_id: z.string(), author_id: z.string(), title: z.string(), body: z.string(), is_pinned: z.boolean(), is_locked: z.boolean(),
  status: z.enum(['published', 'hidden']), reply_count: z.number().int(), last_activity_at: z.string(), created_at: z.string(), edited_at: z.string().nullable(),
}
const TOPIC_COLS = 'id,community_id,author_id,title,body,is_pinned,is_locked,status,reply_count,last_activity_at,created_at,edited_at'

async function toTopics(list: z.infer<z.ZodObject<typeof topicRow>>[]): Promise<Topic[]> {
  const profiles = await profilesByIds(list.map((t) => t.author_id))
  return list.map((t) => ({
    id: t.id, communityId: t.community_id, authorId: t.author_id, author: profiles.get(t.author_id) ?? null, title: t.title, body: t.body,
    isPinned: t.is_pinned, isLocked: t.is_locked, hidden: t.status === 'hidden', replyCount: t.reply_count, lastActivityAt: t.last_activity_at,
    createdAt: t.created_at, editedAt: t.edited_at,
  }))
}

export async function listTopics(communityId: string): Promise<Topic[]> {
  return toTopics(await exec(
    supabase.from('community_topics').select(TOPIC_COLS).eq('community_id', communityId)
      .order('is_pinned', { ascending: false }).order('last_activity_at', { ascending: false }).limit(100),
    rows(topicRow),
  ))
}

export async function getTopic(id: string): Promise<Topic | null> {
  return (await toTopics(await exec(supabase.from('community_topics').select(TOPIC_COLS).eq('id', id), rows(topicRow))))[0] ?? null
}

export const topicFormSchema = z.object({
  title: z.string().trim().min(3, 'Título com pelo menos 3 caracteres.').max(140),
  body: z.string().trim().min(1, 'Escreva o assunto.').max(5000),
})

export async function createTopic(communityId: string, input: z.input<typeof topicFormSchema>): Promise<string> {
  const v = topicFormSchema.parse(input)
  const created = await exec(supabase.from('community_topics').insert({ community_id: communityId, title: v.title, body: v.body }).select('id'), rows({ id: z.string() }))
  return created[0]!.id
}

export async function setTopicFlags(id: string, flags: { isPinned?: boolean; isLocked?: boolean }): Promise<void> {
  const body: Record<string, boolean> = {}
  if (flags.isPinned !== undefined) body.is_pinned = flags.isPinned
  if (flags.isLocked !== undefined) body.is_locked = flags.isLocked
  atLeastOne(await exec(supabase.from('community_topics').update(body).eq('id', id).select('id'), rows({ id: z.string() })))
}

export async function deleteTopic(id: string): Promise<void> {
  atLeastOne(await exec(supabase.from('community_topics').delete().eq('id', id).select('id'), rows({ id: z.string() })))
}

export interface Reply { id: string; authorId: string; author: SocialProfile | null; body: string; hidden: boolean; createdAt: string; editedAt: string | null }
const replyRow = { id: z.string(), author_id: z.string(), body: z.string(), status: z.enum(['published', 'hidden']), created_at: z.string(), edited_at: z.string().nullable() }

export async function listReplies(topicId: string): Promise<Reply[]> {
  const list = await exec(supabase.from('topic_replies').select('id,author_id,body,status,created_at,edited_at').eq('topic_id', topicId).order('created_at').limit(500), rows(replyRow))
  const profiles = await profilesByIds(list.map((r) => r.author_id))
  return list.map((r) => ({ id: r.id, authorId: r.author_id, author: profiles.get(r.author_id) ?? null, body: r.body, hidden: r.status === 'hidden', createdAt: r.created_at, editedAt: r.edited_at }))
}

export async function addReply(topicId: string, body: string): Promise<void> {
  const b = z.string().trim().min(1, 'Escreva a resposta.').max(3000).parse(body)
  await exec(supabase.from('topic_replies').insert({ topic_id: topicId, body: b }).select('id'), rows({ id: z.string() }))
}

export async function deleteReply(id: string): Promise<void> {
  atLeastOne(await exec(supabase.from('topic_replies').delete().eq('id', id).select('id'), rows({ id: z.string() })))
}

export async function moderateCommunityContent(type: 'topic' | 'reply', id: string, hide: boolean): Promise<void> {
  await exec(supabase.rpc('community_moderate_content', { _type: type, _id: id, _hide: hide }), z.any())
}

// ---------- enquetes ----------
export interface Poll { id: string; question: string; closesAt: string; closed: boolean; options: { id: string; label: string; votes: number }[]; myVote: string | null; totalVotes: number }

export async function listPolls(communityId: string, me: string | null): Promise<Poll[]> {
  const polls = await exec(supabase.from('community_polls').select('id,question,closes_at').eq('community_id', communityId).order('created_at', { ascending: false }).limit(20), rows({ id: z.string(), question: z.string(), closes_at: z.string() }))
  if (polls.length === 0) return []
  const ids = polls.map((p) => p.id)
  const [options, votes] = await Promise.all([
    exec(supabase.from('poll_options').select('id,poll_id,label,position,vote_count').in('poll_id', ids).order('position'), rows({ id: z.string(), poll_id: z.string(), label: z.string(), position: z.number(), vote_count: z.number().int() })),
    me ? exec(supabase.from('poll_votes').select('poll_id,option_id').eq('user_id', me).in('poll_id', ids), rows({ poll_id: z.string(), option_id: z.string() })) : Promise.resolve([]),
  ])
  return polls.map((p) => {
    const opts = options.filter((o) => o.poll_id === p.id).map((o) => ({ id: o.id, label: o.label, votes: o.vote_count }))
    return {
      id: p.id, question: p.question, closesAt: p.closes_at, closed: new Date(p.closes_at).getTime() <= Date.now(), options: opts,
      myVote: votes.find((v) => v.poll_id === p.id)?.option_id ?? null, totalVotes: opts.reduce((n, o) => n + o.votes, 0),
    }
  })
}

export async function createPoll(communityId: string, question: string, options: string[], days: number): Promise<void> {
  const q = z.string().trim().min(3, 'Pergunta com pelo menos 3 caracteres.').max(200).parse(question)
  const opts = options.map((o) => o.trim()).filter(Boolean)
  if (opts.length < 2 || opts.length > 6) throw new RepositoryError('validation', 'A enquete precisa de 2 a 6 opções.')
  await exec(supabase.rpc('create_poll', { _community: communityId, _question: q, _options: opts, _days: days }), z.string())
}

export async function vote(pollId: string, optionId: string): Promise<void> {
  await exec(supabase.from('poll_votes').insert({ poll_id: pollId, option_id: optionId }).select('poll_id'), rows({ poll_id: z.string() }))
}
