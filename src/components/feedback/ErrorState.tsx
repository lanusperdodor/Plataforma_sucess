import { TriangleAlert } from 'lucide-react'
import { StateShell, stateButtonClass } from './StateShell'

export interface ErrorStateProps {
  title?: string
  description?: string
  onRetry?: () => void
}

export function ErrorState({
  title = 'Algo deu errado',
  description = 'Não foi possível carregar agora. Tente novamente.',
  onRetry,
}: ErrorStateProps) {
  return (
    <StateShell
      icon={TriangleAlert}
      tone="warm"
      role="alert"
      title={title}
      description={description}
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
