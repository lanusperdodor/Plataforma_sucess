import { z } from 'zod'
import { RepositoryError, backendUnavailable, mapPostgrestError } from '../../lib/errors'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'

/** Solicitação de cadastro de estabelecimento (função submit_business_application, 0005). */

export const applicationSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do negócio.').max(120, 'Máximo de 120 caracteres.'),
  businessType: z.enum(['restaurante', 'loja', 'servico']),
  cityId: z.string().min(1, 'Escolha a cidade.'),
  categoryId: z.string().optional(),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+() -]{8,20}$/, 'Telefone inválido. Ex.: (35) 99999-0000')
    .optional()
    .or(z.literal('')),
  addressLine: z.string().trim().max(200, 'Máximo de 200 caracteres.').optional(),
  description: z.string().trim().max(1000, 'Máximo de 1000 caracteres.').optional(),
})
export type ApplicationInput = z.input<typeof applicationSchema>

export const myBusinessSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    status: z.enum(['pending', 'active', 'suspended', 'rejected']),
    business_type: z.enum(['restaurante', 'loja', 'servico']),
    submitted_at: z.string().nullable(),
    reviewed_at: z.string().nullable(),
    review_note: z.string().nullable(),
    created_at: z.string(),
  })
  .transform((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    businessType: r.business_type,
    submittedAt: r.submitted_at ?? r.created_at,
    reviewedAt: r.reviewed_at,
    reviewNote: r.review_note,
  }))
export type MyBusiness = z.output<typeof myBusinessSchema>

export async function listMyBusinesses(userId: string): Promise<MyBusiness[]> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  const { data, error } = await supabase
    .from('businesses')
    .select('id,name,slug,status,business_type,submitted_at,reviewed_at,review_note,created_at')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw mapPostgrestError(error)
  const parsed = z.array(myBusinessSchema).safeParse(data ?? [])
  if (!parsed.success) throw new RepositoryError('validation', 'Recebemos dados inesperados do servidor.', undefined, { cause: parsed.error })
  return parsed.data
}

export async function submitApplication(input: ApplicationInput): Promise<string> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  const v = applicationSchema.parse(input)
  const { data, error } = await supabase.rpc('submit_business_application', {
    _name: v.name,
    _business_type: v.businessType,
    _city_id: v.cityId,
    _category_id: v.categoryId || null,
    _phone: v.phone || null,
    _description: v.description || null,
    _address_line: v.addressLine || null,
  })
  if (error) throw mapPostgrestError(error)
  return z.string().parse(data)
}
