import { Briefcase } from 'lucide-react'
import { StateShell } from '../components/feedback/StateShell.tsx'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { useCurrentCity } from '../features/location/cityStore.ts'

/** Vagas de emprego. O cadastro real de vagas e candidaturas chega na Sprint 11; nada é inventado. */
export function JobsPage() {
  const { city } = useCurrentCity()
  return (
    <Page>
      <PageHeader icon={Briefcase} title="Vagas" subtitle="Oportunidades no comércio da região." />
      <StateShell
        icon={Briefcase}
        role="status"
        title={`Nenhuma vaga publicada${city ? ` em ${city.name}` : ''}`}
        description="O módulo de vagas está em implementação. Quando as empresas puderem publicar, as oportunidades aparecerão aqui."
      />
    </Page>
  )
}
