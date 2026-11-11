import { DatabaseZap, TriangleAlert } from 'lucide-react'
import { RepositoryError } from '../../lib/errors'
import { StateShell, stateButtonClass } from './StateShell'

export interface ErrorStateProps {
  title?: string
  description?: string
  /** Erro original: mensagens de RepositoryError (pt-BR) são exibidas, e a dependência de backend é sinalizada. */
  error?: unknown
  onRetry?: () => void
}

export function ErrorState({ title, description, error, onRetry }: ErrorStateProps) {
  const repo = error instanceof RepositoryError ? error : null
  const unavailable = repo?.code === 'unavailable'
  return (
    <StateShell
      icon={unavailable ? DatabaseZap : TriangleAlert}
      tone="warm"
      role="alert"
      title={title ?? (unavailable ? (import.meta.env.VITE_STATIC_PREVIEW === '1' ? 'Disponível no site publicado' : 'Serviço indisponível no momento') : 'Algo deu errado')}
      description={description ?? repo?.message ?? 'Não foi possível carregar agora. Tente novamente.'}
      action={
        onRetry ? (
          <button type="button" onClick={onRetry} className={stateButtonClass}>
            Tentar novamente
          </button>
        ) : undefined
      }
    />
  )
}
