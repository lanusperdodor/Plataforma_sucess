import { Link } from 'react-router-dom'
import { NotFoundState } from '../components/feedback/NotFoundState.tsx'
import { Page } from '../components/nav/PageHeader.tsx'

/** Publicação do Conecta. Sem backend ainda (Sprint 9): nenhuma publicação existe. */
export function PostPage() {
  return (
    <Page>
      <NotFoundState />
      <Link to="/conecta" className="pressable mx-auto inline-flex min-h-11 items-center rounded-full border border-line px-5 text-sm font-semibold text-ink">
        Voltar ao Conecta
      </Link>
    </Page>
  )
}
