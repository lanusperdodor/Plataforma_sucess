import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Briefcase } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../components/feedback/EmptyState.tsx'
import { ErrorState } from '../components/feedback/ErrorState.tsx'
import { LoginInvite } from '../components/feedback/LoginInvite.tsx'
import { useToast } from '../components/feedback/toast-context.ts'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import {
  APPLICATION_LABEL,
  AREA_LABEL,
  EMPLOYMENT_LABEL,
  WORK_MODE_LABEL,
  applicationFormSchema,
  applyToJob,
  getJob,
  getMyApplication,
  listMyApplications,
  salaryText,
  withdrawApplication,
  type ApplicationForm,
} from '../features/jobs/repository.ts'
import { formatBRL } from '../lib/money.ts'

const field = 'min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink'
const box = 'rounded-card border border-line bg-surface p-4 md:p-6'
const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' })
const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Algo deu errado. Tente novamente.')

function ApplyForm({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const toast = useToast()
  const [v, setV] = useState<ApplicationForm>({ fullName: '', phone: '', message: '', experience: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = <K extends keyof ApplicationForm>(k: K, val: string) => setV((p) => ({ ...p, [k]: val }))
  const send = useMutation({ mutationFn: () => applyToJob(jobId, v), onSuccess: () => { toast.success('Candidatura enviada!'); onDone() }, onError: (e) => toast.error(msg(e)) })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const parsed = applicationFormSchema.safeParse(v)
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])))
    setErrors({})
    send.mutate()
  }
  const err = (k: string) => (errors[k] ? <p role="alert" className="mt-1 text-xs text-danger">{errors[k]}</p> : null)
  return (
    <form onSubmit={submit} noValidate aria-labelledby="cand" className={`${box} grid grid-cols-1 gap-3 sm:grid-cols-2`}>
      <h2 id="cand" className="text-lg font-semibold text-ink sm:col-span-2">Candidatar-se</h2>
      <div><label htmlFor="ap-name" className="mb-1 block text-sm font-medium text-ink">Nome completo</label><input id="ap-name" autoComplete="name" value={v.fullName} onChange={(e) => set('fullName', e.target.value)} aria-invalid={!!errors.fullName} className={field} />{err('fullName')}</div>
      <div><label htmlFor="ap-phone" className="mb-1 block text-sm font-medium text-ink">Telefone / WhatsApp</label><input id="ap-phone" type="tel" autoComplete="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} aria-invalid={!!errors.phone} className={field} />{err('phone')}</div>
      <div className="sm:col-span-2"><label htmlFor="ap-exp" className="mb-1 block text-sm font-medium text-ink">Experiência (currículo em texto, opcional)</label><textarea id="ap-exp" maxLength={3000} value={v.experience} onChange={(e) => set('experience', e.target.value)} className={`${field} min-h-28 py-2`} />{err('experience')}</div>
      <div className="sm:col-span-2"><label htmlFor="ap-msg" className="mb-1 block text-sm font-medium text-ink">Mensagem para a empresa (opcional)</label><textarea id="ap-msg" maxLength={1500} value={v.message} onChange={(e) => set('message', e.target.value)} className={`${field} min-h-20 py-2`} />{err('message')}</div>
      <p className="text-xs text-ink-muted sm:col-span-2">Seus dados ficam visíveis só para o dono e o gerente deste estabelecimento. Você pode retirar a candidatura a qualquer momento.</p>
      <button type="submit" disabled={send.isPending} className="pressable inline-flex min-h-12 w-fit items-center rounded-full bg-orange px-6 font-semibold text-ink disabled:opacity-50">{send.isPending ? 'Enviando…' : 'Enviar candidatura'}</button>
    </form>
  )
}

export function JobPage() {
  const { id = '' } = useParams()
  const { session } = useAuth()
  const me = session?.user.id
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['jobs', 'detail', id], queryFn: () => getJob(id), enabled: !!id })
  const mine = useQuery({ queryKey: ['jobs', 'mine', id, me ?? ''], queryFn: () => getMyApplication(me!, id), enabled: !!me && !!id })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['jobs'] })
  const withdraw = useMutation({ mutationFn: (appId: string) => withdrawApplication(appId), onSuccess: () => { toast.success('Candidatura retirada.'); refresh() }, onError: (e) => toast.error(msg(e)) })

  if (q.isLoading) return <Page><p role="status" className="text-sm text-ink-muted">Carregando…</p></Page>
  if (q.isError) return <Page><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Page>
  const j = q.data
  if (!j) return <Page><EmptyState icon={Briefcase} title="Vaga indisponível" description="Ela foi encerrada, expirou ou o endereço está incorreto." action={<Link to="/vagas" className="text-sm font-semibold text-brand underline">Ver vagas abertas</Link>} /></Page>
  const app = mine.data
  return (
    <Page>
      <PageHeader icon={Briefcase} title={j.title} subtitle={j.business?.name ?? 'Estabelecimento'} />
      <section className={`${box} flex flex-col gap-3`}>
        <ul className="flex flex-wrap gap-2 text-sm">
          {[EMPLOYMENT_LABEL[j.employment], WORK_MODE_LABEL[j.workMode], AREA_LABEL[j.area], salaryText(j, formatBRL), j.openings > 1 ? `${j.openings} vagas` : '1 vaga'].map((t) => (
            <li key={t} className="rounded-full bg-muted px-3 py-1 text-ink">{t}</li>
          ))}
        </ul>
        <div><h2 className="mb-1 text-base font-semibold text-ink">Descrição</h2><p className="whitespace-pre-line text-sm text-ink">{j.description}</p></div>
        {j.requirements && <div><h2 className="mb-1 text-base font-semibold text-ink">Requisitos</h2><p className="whitespace-pre-line text-sm text-ink">{j.requirements}</p></div>}
        {j.benefits && <div><h2 className="mb-1 text-base font-semibold text-ink">Benefícios</h2><p className="whitespace-pre-line text-sm text-ink">{j.benefits}</p></div>}
        <p className="text-xs text-ink-muted">Publicada em {dateFmt.format(new Date(j.createdAt))} · inscrições até {dateFmt.format(new Date(j.expiresAt))}</p>
        {j.business && <Link to={`/${j.business.businessType === 'restaurante' ? 'restaurantes' : j.business.businessType === 'loja' ? 'lojas' : 'servicos'}/${j.business.slug}`} className="w-fit text-sm font-semibold text-brand underline">Conhecer {j.business.name}</Link>}
      </section>
      {!session ? (
        <LoginInvite icon={Briefcase} title="Entre para se candidatar" description="Você acompanha o andamento da candidatura pela sua conta." />
      ) : mine.isLoading ? null : app ? (
        <section className={`${box} flex flex-col gap-2`}>
          <h2 className="text-lg font-semibold text-ink">Sua candidatura</h2>
          <p className="text-sm text-ink">Situação: <strong>{APPLICATION_LABEL[app.status]}</strong> · enviada em {dateFmt.format(new Date(app.createdAt))}</p>
          {app.employerNote && <p className="text-sm text-ink">Recado da empresa: {app.employerNote}</p>}
          {!['hired', 'rejected', 'withdrawn'].includes(app.status) && (
            <button type="button" disabled={withdraw.isPending} onClick={() => { if (window.confirm('Retirar sua candidatura?')) withdraw.mutate(app.id) }} className="pressable inline-flex min-h-11 w-fit items-center rounded-full border border-line px-4 text-sm font-semibold text-danger">Retirar candidatura</button>
          )}
        </section>
      ) : (
        <ApplyForm jobId={j.id} onDone={refresh} />
      )}
    </Page>
  )
}

/** Candidaturas da pessoa, com andamento. */
export function MyApplicationsPage() {
  const { session } = useAuth()
  const me = session?.user.id
  const q = useQuery({ queryKey: ['jobs', 'applications', me ?? ''], queryFn: () => listMyApplications(me!), enabled: !!me })
  return (
    <Page>
      <PageHeader icon={Briefcase} title="Minhas candidaturas" subtitle="Acompanhe o andamento." />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState icon={Briefcase} title={q.isLoading ? 'Carregando…' : 'Nenhuma candidatura ainda'} action={<Link to="/vagas" className="pressable inline-flex min-h-11 items-center rounded-full bg-orange px-5 text-sm font-semibold text-ink">Ver vagas</Link>} />
      ) : (
        <ul className="flex flex-col gap-2">
          {(q.data ?? []).map((a) => (
            <li key={a.id} className={`${box} flex flex-col gap-1`}>
              {a.job ? <Link to={`/vagas/${a.jobId}`} className="font-semibold text-ink underline">{a.job.title}</Link> : <span className="font-semibold text-ink">Vaga encerrada</span>}
              <span className="text-sm text-ink">{APPLICATION_LABEL[a.status]} · {dateFmt.format(new Date(a.createdAt))}</span>
              {a.employerNote && <span className="text-sm text-ink-muted">Recado: {a.employerNote}</span>}
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}
