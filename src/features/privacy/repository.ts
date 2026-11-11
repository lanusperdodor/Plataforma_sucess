import { z } from 'zod'
import { RepositoryError, backendUnavailable, mapPostgrestError } from '../../lib/errors'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'

/** Direitos do titular (LGPD): funções da migration 0006. */

export const privacyKinds = ['access', 'correction', 'portability', 'deletion', 'sharing_info', 'consent_revocation', 'objection'] as const
export type PrivacyKind = (typeof privacyKinds)[number]
export const privacyStatuses = ['open', 'in_progress', 'completed', 'rejected'] as const
export type PrivacyStatus = (typeof privacyStatuses)[number]

export const PRIVACY_KIND_LABEL: Record<PrivacyKind, string> = {
  access: 'Confirmar e acessar meus dados',
  correction: 'Corrigir dados',
  portability: 'Portabilidade',
  deletion: 'Excluir minha conta',
  sharing_info: 'Saber com quem meus dados são compartilhados',
  consent_revocation: 'Revogar consentimento',
  objection: 'Opor-me a um tratamento',
}

export const PRIVACY_STATUS_LABEL: Record<PrivacyStatus, string> = {
  open: 'Recebida',
  in_progress: 'Em atendimento',
  completed: 'Concluída',
  rejected: 'Não atendida',
}

function fail(e: { code?: string; message: string }): never {
  throw mapPostgrestError(e)
}

export const privacyRequestSchema = z
  .object({
    id: z.string(),
    kind: z.enum(privacyKinds),
    details: z.string().nullable(),
    status: z.enum(privacyStatuses),
    resolution_note: z.string().nullable(),
    resolved_at: z.string().nullable(),
    created_at: z.string(),
  })
  .transform((r) => ({
    id: r.id,
    kind: r.kind,
    details: r.details,
    status: r.status,
    resolutionNote: r.resolution_note,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
  }))
export type PrivacyRequest = z.output<typeof privacyRequestSchema>

export async function listMyPrivacyRequests(userId: string): Promise<PrivacyRequest[]> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  const { data, error } = await supabase
    .from('privacy_requests')
    .select('id,kind,details,status,resolution_note,resolved_at,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) fail(error)
  const parsed = z.array(privacyRequestSchema).safeParse(data ?? [])
  if (!parsed.success) throw new RepositoryError('validation', 'Recebemos dados inesperados do servidor.', undefined, { cause: parsed.error })
  return parsed.data
}

export const requestInputSchema = z.object({
  kind: z.enum(privacyKinds),
  details: z.string().trim().max(2000, 'Máximo de 2000 caracteres.').optional(),
})

export async function submitPrivacyRequest(kind: PrivacyKind, details?: string): Promise<string> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  const v = requestInputSchema.parse({ kind, details })
  const { data, error } = await supabase.rpc('submit_privacy_request', { _kind: v.kind, _details: v.details || null })
  if (error) fail(error)
  return z.string().parse(data)
}

export async function exportMyData(): Promise<unknown> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  const { data, error } = await supabase.rpc('my_data_export')
  if (error) fail(error)
  return data
}

// ---------- atendimento (Painel Master, permissão privacy.manage) ----------
export const adminPrivacyRequestSchema = z
  .object({
    id: z.string(),
    user_id: z.string().nullable(),
    user_email: z.string().nullable(),
    kind: z.enum(privacyKinds),
    details: z.string().nullable(),
    status: z.enum(privacyStatuses),
    resolution_note: z.string().nullable(),
    resolved_at: z.string().nullable(),
    created_at: z.string(),
  })
  .transform((r) => ({
    id: r.id,
    userEmail: r.user_email,
    kind: r.kind,
    details: r.details,
    status: r.status,
    resolutionNote: r.resolution_note,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
  }))
export type AdminPrivacyRequest = z.output<typeof adminPrivacyRequestSchema>

export async function adminListPrivacyRequests(status: PrivacyStatus | null): Promise<AdminPrivacyRequest[]> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  const { data, error } = await supabase.rpc('admin_list_privacy_requests', { _status: status })
  if (error) fail(error)
  const parsed = z.array(adminPrivacyRequestSchema).safeParse(data ?? [])
  if (!parsed.success) throw new RepositoryError('validation', 'Recebemos dados inesperados do servidor.', undefined, { cause: parsed.error })
  return parsed.data
}

export async function adminResolvePrivacyRequest(id: string, status: Exclude<PrivacyStatus, 'open'>, note: string, anonymize = false): Promise<void> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  const { error } = await supabase.rpc('admin_resolve_privacy_request', {
    _request: id,
    _status: status,
    _note: note.trim() || null,
    _anonymize: anonymize,
  })
  if (error) fail(error)
}
