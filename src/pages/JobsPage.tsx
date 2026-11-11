import { useQuery } from '@tanstack/react-query'
import { Briefcase, MapPin } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ErrorState } from '../components/feedback/ErrorState.tsx'
import { StateShell } from '../components/feedback/StateShell.tsx'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import { AREA_LABEL, EMPLOYMENT_LABEL, WORK_MODE_LABEL, jobAreas, listPublicJobs, salaryText, type JobArea } from '../features/jobs/repository.ts'
import { useCurrentCity } from '../features/location/cityStore.ts'
import { formatBRL } from '../lib/money.ts'

const chip = (on: boolean) => `pressable inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-semibold ${on ? 'bg-brand text-surface' : 'border border-line text-ink'}`

/** Vagas abertas publicadas por estabelecimentos ativos (dados reais, RLS). */
export function JobsPage() {
  const { city } = useCurrentCity()
  const { session } = useAuth()
  const [area, setArea] = useState<JobArea | null>(null)
  const q = useQuery({ queryKey: ['jobs', 'public', city?.id ?? '', area ?? ''], queryFn: () => listPublicJobs(city?.id ?? null, area) })
  return (
    <Page>
      <PageHeader
        icon={Briefcase}
        title="Vagas"
        subtitle={`Oportunidades no comércio${city ? ` de ${city.name}` : ' da região'}.`}
        actions={session ? <Link to="/vagas/minhas-candidaturas" className="pressable inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold text-ink">Minhas candidaturas</Link> : undefined}
      />
      <nav aria-label="Áreas" className="flex gap-2 overflow-x-auto pb-1">
        <button type="button" aria-pressed={area === null} onClick={() => setArea(null)} className={chip(area === null)}>Todas</button>
        {jobAreas.map((a) => (
          <button key={a} type="button" aria-pressed={area === a} onClick={() => setArea(a)} className={chip(area === a)}>{AREA_LABEL[a]}</button>
        ))}
      </nav>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <StateShell
          icon={Briefcase}
          role="status"
          title={q.isLoading ? 'Carregando vagas…' : `Nenhuma vaga aberta${city ? ` em ${city.name}` : ''}${area ? ` em ${AREA_LABEL[area]}` : ''}`}
          description={q.isLoading ? undefined : 'Estabelecimentos parceiros publicam vagas pelo painel. Volte em breve ou troque de cidade.'}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(q.data ?? []).map((j) => (
            <li key={j.id}>
              <Link to={`/vagas/${j.id}`} className="hover-lift pressable flex h-full flex-col gap-1 rounded-card border border-line bg-surface p-4">
                <span className="text-base font-semibold text-ink">{j.title}</span>
                <span className="text-sm text-ink">{j.business?.name ?? 'Estabelecimento'}</span>
                <span className="text-sm text-ink-muted">{EMPLOYMENT_LABEL[j.employment]} · {WORK_MODE_LABEL[j.workMode]} · {AREA_LABEL[j.area]}</span>
                <span className="text-sm font-semibold text-ink">{salaryText(j, formatBRL)}</span>
                {j.openings > 1 && <span className="text-xs text-ink-muted">{j.openings} vagas</span>}
                {city && <span className="inline-flex items-center gap-1 text-xs text-ink-muted"><MapPin aria-hidden="true" className="size-3" />{city.name}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}
