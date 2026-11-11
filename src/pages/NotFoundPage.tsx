import { Link } from 'react-router-dom'
import { NotFoundState } from '../components/feedback/NotFoundState.tsx'
import { Page } from '../components/nav/PageHeader.tsx'

export function NotFoundPage() {
  return (
    <Page>
      <h1 className="sr-only">Página não encontrada</h1>
      <NotFoundState
        title="Página não encontrada"
        action={<Link to="/" className="pressable inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-sm font-semibold text-surface">Ir para o início</Link>}
      />
    </Page>
  )
}
