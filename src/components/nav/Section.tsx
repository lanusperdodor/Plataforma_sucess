import { ChevronRight } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../feedback/EmptyState'

export interface SectionProps {
  title: string
  subtitle?: string
  /** Destino do link "Ver mais". */
  moreTo?: string
  children?: ReactNode
  /** Quando true, mostra o estado vazio (ou oculta a seção com `hideWhenEmpty`). */
  empty?: boolean
  hideWhenEmpty?: boolean
  emptyTitle?: string
  emptyDescription?: string
  /** `carousel`: rolagem horizontal com snap no mobile e grade no desktop. */
  variant?: 'grid' | 'carousel'
}

export function Section({
  title,
  subtitle,
  moreTo,
  children,
  empty = false,
  hideWhenEmpty = false,
  emptyTitle = 'Nada por aqui ainda',
  emptyDescription,
  variant = 'grid',
}: SectionProps) {
  const headingId = useId()
  if (empty && hideWhenEmpty) return null

  const body = empty
    ? null
    : variant === 'carousel'
      ? 'flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [&>*]:w-[80%] [&>*]:shrink-0 [&>*]:snap-start md:grid md:grid-cols-2 md:overflow-visible md:[&>*]:w-auto lg:grid-cols-3'
      : 'grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3'

  return (
    <section aria-labelledby={headingId} className="min-w-0 max-w-full">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg font-semibold text-ink">
            {title}
          </h2>
          {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
        </div>
        {moreTo && !empty && (
          <Link
            to={moreTo}
            className="pressable inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-semibold text-brand"
          >
            Ver mais
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        )}
      </div>
      {empty ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className={body ?? undefined}>{children}</div>
      )}
    </section>
  )
}
