import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { TriangleAlert } from 'lucide-react'
import { ErrorState } from '../components/feedback/ErrorState.tsx'
import { StateShell, stateButtonClass } from '../components/feedback/StateShell.tsx'
import { Skeleton, SkeletonCard } from '../components/feedback/Skeleton.tsx'

/** Cabeçalho + grade de cards, reservando espaço para evitar salto de layout. */
export function RouteSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4" role="status" aria-label="Carregando">
      <Skeleton className="h-8 w-1/2" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  )
}

export function isChunkLoadError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /ChunkLoadError|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
    text,
  )
}

type BoundaryState = { error: unknown; failed: boolean }

class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null, failed: false }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error, failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Erro na rota', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    if (isChunkLoadError(this.state.error)) {
      return (
        <StateShell
          icon={TriangleAlert}
          tone="warm"
          role="alert"
          title="Não foi possível carregar esta tela"
          description="Verifique sua conexão e tente de novo."
          action={
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={stateButtonClass}
            >
              Recarregar
            </button>
          }
        />
      )
    }
    return <ErrorState onRetry={() => this.setState({ error: null, failed: false })} />
  }
}

/** ErrorBoundary + Suspense; reinicia o erro ao trocar de rota. */
export function RouteBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary key={pathname}>
      <Suspense fallback={<RouteSkeleton />}>{children}</Suspense>
    </ErrorBoundary>
  )
}
