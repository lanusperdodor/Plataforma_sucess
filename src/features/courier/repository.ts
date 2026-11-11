import { z } from 'zod'
import { RepositoryError, backendUnavailable, mapPostgrestError } from '../../lib/errors'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'

/** Entregadores parceiros (0009). Escrita só por funções no servidor. */

export const vehicles = ['moto', 'bicicleta', 'carro', 'a_pe'] as const
export type Vehicle = (typeof vehicles)[number]
export const VEHICLE_LABEL: Record<Vehicle, string> = { moto: 'Moto', bicicleta: 'Bicicleta', carro: 'Carro', a_pe: 'A pé' }
export const courierStatuses = ['pending', 'approved', 'rejected', 'suspended'] as const
export type CourierStatus = (typeof courierStatuses)[number]

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

const motorized = (v: Vehicle) => v === 'moto' || v === 'carro'

export const courierFormSchema = z
  .object({
    fullName: z.string().trim().min(3, 'Informe seu nome completo.').max(120),
    phone: z.string().trim().regex(/^[0-9+() -]{8,20}$/, 'Telefone inválido. Ex.: (35) 99999-0000'),
    cityId: z.string().min(1, 'Escolha a cidade.'),
    vehicle: z.enum(vehicles),
    plate: z.string().trim(),
    cnh: z.string().trim(),
    acceptTerms: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (!v.acceptTerms) ctx.addIssue({ code: 'custom', path: ['acceptTerms'], message: 'É preciso aceitar os termos de parceria.' })
    if (motorized(v.vehicle)) {
      if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(v.plate.toUpperCase().replace(/[^A-Z0-9]/g, '')))
        ctx.addIssue({ code: 'custom', path: ['plate'], message: 'Placa inválida. Ex.: ABC1D23' })
      if (!['A', 'B', 'AB', 'AC', 'AD', 'AE'].includes(v.cnh.toUpperCase()))
        ctx.addIssue({ code: 'custom', path: ['cnh'], message: 'Categoria da CNH inválida.' })
    }
  })
export type CourierForm = z.input<typeof courierFormSchema>

export function courierFormToArgs(input: CourierForm) {
  const v = courierFormSchema.parse(input)
  return {
    _full_name: v.fullName,
    _phone: v.phone,
    _city_id: v.cityId,
    _vehicle: v.vehicle,
    _vehicle_plate: motorized(v.vehicle) ? v.plate.toUpperCase().replace(/[^A-Z0-9]/g, '') : null,
    _cnh_category: motorized(v.vehicle) ? v.cnh.toUpperCase() : null,
    _accept_terms: v.acceptTerms,
  }
}

export async function submitCourierApplication(input: CourierForm): Promise<CourierStatus> {
  return exec(supabase.rpc('submit_courier_application', courierFormToArgs(input)), z.enum(courierStatuses))
}

const mySchema = z
  .object({
    full_name: z.string(), phone: z.string(), city_id: z.string(), vehicle: z.enum(vehicles), vehicle_plate: z.string().nullable(),
    cnh_category: z.string().nullable(), status: z.enum(courierStatuses), is_online: z.boolean(), review_note: z.string().nullable(), submitted_at: z.string(),
  })
  .transform((r) => ({
    fullName: r.full_name, phone: r.phone, cityId: r.city_id, vehicle: r.vehicle, plate: r.vehicle_plate, cnh: r.cnh_category,
    status: r.status, isOnline: r.is_online, reviewNote: r.review_note, submittedAt: r.submitted_at,
  }))
export type MyCourier = z.output<typeof mySchema>

export async function getMyCourier(userId: string): Promise<MyCourier | null> {
  return exec(
    supabase.from('couriers').select('full_name,phone,city_id,vehicle,vehicle_plate,cnh_category,status,is_online,review_note,submitted_at').eq('user_id', userId).maybeSingle(),
    mySchema.nullable(),
  )
}

export async function setOnline(online: boolean): Promise<boolean> {
  return exec(supabase.rpc('set_courier_online', { _online: online }), z.boolean())
}

// ---------- equipe ----------
const adminSchema = z
  .object({
    user_id: z.string(), email: z.string().nullable(), full_name: z.string(), phone: z.string(), city_name: z.string().nullable(),
    vehicle: z.enum(vehicles), vehicle_plate: z.string().nullable(), cnh_category: z.string().nullable(), status: z.enum(courierStatuses),
    is_online: z.boolean(), review_note: z.string().nullable(), submitted_at: z.string(), reviewed_at: z.string().nullable(),
  })
  .transform((r) => ({
    userId: r.user_id, email: r.email, fullName: r.full_name, phone: r.phone, city: r.city_name, vehicle: r.vehicle, plate: r.vehicle_plate,
    cnh: r.cnh_category, status: r.status, isOnline: r.is_online, reviewNote: r.review_note, submittedAt: r.submitted_at, reviewedAt: r.reviewed_at,
  }))
export type AdminCourier = z.output<typeof adminSchema>

export async function adminListCouriers(status: CourierStatus | null): Promise<AdminCourier[]> {
  return exec(supabase.rpc('admin_list_couriers', { _status: status }), z.array(adminSchema))
}

export async function adminReviewCourier(userId: string, decision: 'approve' | 'reject' | 'suspend' | 'reactivate', note = ''): Promise<CourierStatus> {
  return exec(supabase.rpc('admin_review_courier', { _user: userId, _decision: decision, _note: note.trim() || null }), z.enum(courierStatuses))
}
