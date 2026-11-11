import { z } from 'zod'
import { RepositoryError, backendUnavailable, mapPostgrestError } from '../../lib/errors'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'

/** Vagas e candidaturas (0013). Escrita só por funções no servidor; leitura sob RLS. */

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

export const jobAreas = ['atendimento', 'cozinha', 'entregas', 'vendas', 'administrativo', 'servicos_gerais', 'tecnologia', 'outros'] as const
export type JobArea = (typeof jobAreas)[number]
export const AREA_LABEL: Record<JobArea, string> = {
  atendimento: 'Atendimento', cozinha: 'Cozinha', entregas: 'Entregas', vendas: 'Vendas', administrativo: 'Administrativo',
  servicos_gerais: 'Serviços gerais', tecnologia: 'Tecnologia', outros: 'Outros',
}
export const employments = ['clt', 'pj', 'temporario', 'estagio', 'freelancer', 'meio_periodo'] as const
export type Employment = (typeof employments)[number]
export const EMPLOYMENT_LABEL: Record<Employment, string> = {
  clt: 'CLT', pj: 'PJ', temporario: 'Temporário', estagio: 'Estágio', freelancer: 'Freelancer', meio_periodo: 'Meio período',
}
export const workModes = ['presencial', 'hibrido', 'remoto'] as const
export type WorkMode = (typeof workModes)[number]
export const WORK_MODE_LABEL: Record<WorkMode, string> = { presencial: 'Presencial', hibrido: 'Híbrido', remoto: 'Remoto' }
export const jobStatuses = ['open', 'paused', 'closed'] as const
export type JobStatus = (typeof jobStatuses)[number]
export const JOB_STATUS_LABEL: Record<JobStatus, string> = { open: 'Aberta', paused: 'Pausada', closed: 'Encerrada' }
export const applicationStatuses = ['submitted', 'reviewing', 'interview', 'rejected', 'hired', 'withdrawn'] as const
export type ApplicationStatus = (typeof applicationStatuses)[number]
export const APPLICATION_LABEL: Record<ApplicationStatus, string> = {
  submitted: 'Enviada', reviewing: 'Em análise', interview: 'Entrevista', rejected: 'Não seguiu', hired: 'Aprovada', withdrawn: 'Retirada',
}

const JOB_COLUMNS =
  'id,business_id,city_id,title,area,description,requirements,benefits,employment_type,work_mode,salary_min_cents,salary_max_cents,openings,status,expires_at,closed_reason,created_at'

const jobSchema = z
  .object({
    id: z.string(), business_id: z.string(), city_id: z.string().nullable(), title: z.string(), area: z.enum(jobAreas), description: z.string(),
    requirements: z.string().nullable(), benefits: z.string().nullable(), employment_type: z.enum(employments), work_mode: z.enum(workModes),
    salary_min_cents: z.number().int().nullable(), salary_max_cents: z.number().int().nullable(), openings: z.number().int(),
    status: z.enum(jobStatuses), expires_at: z.string(), closed_reason: z.string().nullable(), created_at: z.string(),
  })
  .transform((r) => ({
    id: r.id, businessId: r.business_id, cityId: r.city_id, title: r.title, area: r.area, description: r.description,
    requirements: r.requirements, benefits: r.benefits, employment: r.employment_type, workMode: r.work_mode,
    salaryMinCents: r.salary_min_cents, salaryMaxCents: r.salary_max_cents, openings: r.openings, status: r.status,
    expiresAt: r.expires_at, closedReason: r.closed_reason, createdAt: r.created_at,
  }))
export type Job = z.output<typeof jobSchema>
export type JobWithBusiness = Job & { business: { name: string; slug: string; businessType: string } | null }

const bizSchema = z.object({ id: z.string(), name: z.string(), slug: z.string(), business_type: z.string() })
async function withBusiness(jobs: Job[]): Promise<JobWithBusiness[]> {
  const ids = [...new Set(jobs.map((j) => j.businessId))]
  if (ids.length === 0) return []
  const rows = await exec(supabase.from('public_businesses').select('id,name,slug,business_type').in('id', ids), z.array(bizSchema))
  const map = new Map(rows.map((b) => [b.id, { name: b.name, slug: b.slug, businessType: b.business_type }]))
  return jobs.map((j) => ({ ...j, business: map.get(j.businessId) ?? null }))
}

export function salaryText(j: Pick<Job, 'salaryMinCents' | 'salaryMaxCents'>, fmt: (c: number) => string): string {
  if (j.salaryMinCents && j.salaryMaxCents && j.salaryMinCents !== j.salaryMaxCents) return `${fmt(j.salaryMinCents)} a ${fmt(j.salaryMaxCents)}`
  if (j.salaryMinCents ?? j.salaryMaxCents) return fmt((j.salaryMinCents ?? j.salaryMaxCents)!)
  return 'A combinar'
}

/** Vagas abertas (a RLS mostra ao público só as abertas, válidas e de lojas ativas). */
export async function listPublicJobs(cityId: string | null, area: JobArea | null): Promise<JobWithBusiness[]> {
  let q = supabase.from('jobs').select(JOB_COLUMNS).eq('status', 'open').gte('expires_at', new Date().toISOString())
  if (cityId) q = q.eq('city_id', cityId)
  if (area) q = q.eq('area', area)
  const jobs = await exec(q.order('created_at', { ascending: false }).limit(60), z.array(jobSchema))
  return withBusiness(jobs)
}

export async function getJob(id: string): Promise<JobWithBusiness | null> {
  const job = await exec(supabase.from('jobs').select(JOB_COLUMNS).eq('id', id).maybeSingle(), jobSchema.nullable())
  if (!job) return null
  return (await withBusiness([job]))[0] ?? null
}

export async function listBusinessJobs(businessId: string): Promise<Job[]> {
  return exec(supabase.from('jobs').select(JOB_COLUMNS).eq('business_id', businessId).order('created_at', { ascending: false }).limit(100), z.array(jobSchema))
}

// ---------- publicar ----------
const money = z.string().trim().refine((s) => s === '' || /^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s), 'Valor inválido. Ex.: 1.800,00')
export const jobFormSchema = z
  .object({
    title: z.string().trim().min(3, 'Informe o cargo.').max(120),
    area: z.enum(jobAreas),
    description: z.string().trim().min(20, 'Descreva a vaga (mínimo 20 caracteres).').max(4000),
    requirements: z.string().trim().max(2000),
    benefits: z.string().trim().max(1000),
    employment: z.enum(employments),
    workMode: z.enum(workModes),
    salaryMin: money,
    salaryMax: money,
    openings: z.string().trim().regex(/^\d{1,3}$/, 'Número de vagas inválido.'),
    days: z.string().trim().regex(/^\d{1,2}$/, 'Validade inválida.'),
  })
  .superRefine((v, ctx) => {
    const n = Number(v.openings)
    if (n < 1 || n > 100) ctx.addIssue({ code: 'custom', path: ['openings'], message: 'De 1 a 100 vagas.' })
    const d = Number(v.days)
    if (d < 1 || d > 90) ctx.addIssue({ code: 'custom', path: ['days'], message: 'Validade de 1 a 90 dias.' })
    const min = v.salaryMin ? toCents(v.salaryMin) : null
    const max = v.salaryMax ? toCents(v.salaryMax) : null
    if (min && max && max < min) ctx.addIssue({ code: 'custom', path: ['salaryMax'], message: 'O máximo precisa ser maior que o mínimo.' })
  })
export type JobForm = z.input<typeof jobFormSchema>

function toCents(s: string): number {
  const [i = '0', d = ''] = s.replace(/\./g, '').split(',')
  return Number(i) * 100 + Number(d.padEnd(2, '0'))
}

export function jobFormToArgs(businessId: string, input: JobForm, jobId: string | null) {
  const v = jobFormSchema.parse(input)
  return {
    _business: businessId, _title: v.title, _area: v.area, _description: v.description, _employment: v.employment, _work_mode: v.workMode,
    _requirements: v.requirements || null, _benefits: v.benefits || null,
    _salary_min_cents: v.salaryMin ? toCents(v.salaryMin) : null, _salary_max_cents: v.salaryMax ? toCents(v.salaryMax) : null,
    _openings: Number(v.openings), _days: Number(v.days), _job: jobId,
  }
}

export async function saveJob(businessId: string, input: JobForm, jobId: string | null): Promise<string> {
  return exec(supabase.rpc('save_job', jobFormToArgs(businessId, input, jobId)), z.string())
}

export async function setJobStatus(jobId: string, status: JobStatus, reason = ''): Promise<void> {
  await exec(supabase.rpc('set_job_status', { _job: jobId, _status: status, _reason: reason.trim() || null }), z.unknown())
}

// ---------- candidaturas ----------
export const applicationFormSchema = z.object({
  fullName: z.string().trim().min(3, 'Informe seu nome completo.').max(120),
  phone: z.string().trim().regex(/^[0-9+() -]{8,20}$/, 'Telefone inválido. Ex.: (35) 99999-0000'),
  message: z.string().trim().max(1500, 'Até 1500 caracteres.'),
  experience: z.string().trim().max(3000, 'Até 3000 caracteres.'),
})
export type ApplicationForm = z.input<typeof applicationFormSchema>

export async function applyToJob(jobId: string, input: ApplicationForm): Promise<string> {
  const v = applicationFormSchema.parse(input)
  return exec(
    supabase.rpc('apply_to_job', { _job: jobId, _full_name: v.fullName, _phone: v.phone, _message: v.message || null, _experience: v.experience || null }),
    z.string(),
  )
}

const applicationSchema = z
  .object({
    id: z.string(), job_id: z.string(), full_name: z.string(), phone: z.string(), message: z.string().nullable(), experience: z.string().nullable(),
    status: z.enum(applicationStatuses), employer_note: z.string().nullable(), created_at: z.string(),
  })
  .transform((r) => ({
    id: r.id, jobId: r.job_id, fullName: r.full_name, phone: r.phone, message: r.message, experience: r.experience,
    status: r.status, employerNote: r.employer_note, createdAt: r.created_at,
  }))
export type Application = z.output<typeof applicationSchema>
const APP_COLUMNS = 'id,job_id,full_name,phone,message,experience,status,employer_note,created_at'

export async function getMyApplication(userId: string, jobId: string): Promise<Application | null> {
  return exec(supabase.from('job_applications').select(APP_COLUMNS).eq('applicant_id', userId).eq('job_id', jobId).maybeSingle(), applicationSchema.nullable())
}

export type MyApplication = Application & { job: Job | null }
export async function listMyApplications(userId: string): Promise<MyApplication[]> {
  const apps = await exec(
    supabase.from('job_applications').select(APP_COLUMNS).eq('applicant_id', userId).order('created_at', { ascending: false }).limit(100),
    z.array(applicationSchema),
  )
  if (apps.length === 0) return []
  // vagas encerradas deixam de ser públicas: o título fica indisponível nesse caso
  const jobs = await exec(supabase.from('jobs').select(JOB_COLUMNS).in('id', [...new Set(apps.map((a) => a.jobId))]), z.array(jobSchema))
  const map = new Map(jobs.map((j) => [j.id, j]))
  return apps.map((a) => ({ ...a, job: map.get(a.jobId) ?? null }))
}

export async function withdrawApplication(id: string): Promise<void> {
  await exec(supabase.rpc('withdraw_application', { _application: id }), z.unknown())
}

export async function listJobApplications(jobId: string): Promise<Application[]> {
  return exec(supabase.from('job_applications').select(APP_COLUMNS).eq('job_id', jobId).order('created_at', { ascending: true }), z.array(applicationSchema))
}

export async function updateApplicationStatus(id: string, status: ApplicationStatus, note = ''): Promise<void> {
  await exec(supabase.rpc('update_application_status', { _application: id, _status: status, _note: note.trim() || null }), z.unknown())
}
