import { Briefcase, Building2, Clock } from 'lucide-react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useToast } from '../components/feedback/toast-context.ts'
import { FilterChips } from '../components/nav/FilterChips.tsx'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import { DEMO_JOBS, type DemoJob } from '../features/demo/preview-data.ts'

const CATEGORIES = ['Todas', 'Alimentação', 'Comércio', 'Beleza', 'Entregas', 'Serviços'] as const
type Cat = (typeof CATEGORIES)[number]

function postedLabel(days: number) {
  return days === 0 ? 'Hoje' : days === 1 ? 'Ontem' : `Há ${days} dias`
}

function JobCard({ job, onApply }: { job: DemoJob; onApply: (j: DemoJob) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <article className="flex w-full flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-bold text-ink">{job.title}</h2>
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-ink">{job.type}</span>
        </div>
        <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-ink-muted">
          <Building2 aria-hidden="true" className="size-4 shrink-0" />
          {job.businessName}
        </p>
        <p className="mt-1 flex items-center gap-1 text-xs text-ink-muted">
          {job.category} · <Clock aria-hidden="true" className="size-3" /> {postedLabel(job.daysAgo)}
        </p>
      </div>
      {open && (
        <p className="text-sm text-ink">
          {job.description}
          {job.salary ? ` Salário: ${job.salary}.` : ''} {job.city}.
        </p>
      )}
      <div className="mt-auto flex gap-2">
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="pressable min-h-11 flex-1 rounded-full border border-line px-4 text-sm font-semibold text-ink">
          {open ? 'Ver menos' : 'Ver mais'}
        </button>
        <button type="button" onClick={() => onApply(job)} className="pressable min-h-11 flex-1 rounded-full bg-orange px-4 text-sm font-semibold text-ink">
          Candidatar
        </button>
      </div>
    </article>
  )
}

/** Vagas e oportunidades do comércio local (prévia com vagas de demonstração). */
export function JobsPage() {
  const [cat, setCat] = useState<Cat>('Todas')
  const { session } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const jobs = DEMO_JOBS.filter((j) => cat === 'Todas' || j.category === cat)
  const apply = () => {
    if (!session) {
      navigate('/entrar', { state: { from: location.pathname } })
      return
    }
    toast.info('Vaga de demonstração: nenhuma candidatura foi enviada.')
  }
  return (
    <Page>
      <PageHeader icon={Briefcase} title="Vagas" subtitle="Oportunidades no comércio da região." />
      <FilterChips label="Área" options={CATEGORIES.map((c) => ({ value: c, label: c }))} value={cat} onChange={setCat} />
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {jobs.map((j) => (
          <li key={j.id} className="flex">
            <JobCard job={j} onApply={apply} />
          </li>
        ))}
      </ul>
      {jobs.length === 0 && <p className="text-sm text-ink-muted">Nenhuma vaga nesta área por enquanto.</p>}
    </Page>
  )
}