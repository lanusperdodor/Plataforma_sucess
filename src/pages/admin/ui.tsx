import type { ReactNode } from 'react'

export function AdminHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </header>
  )
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-card border border-line bg-surface p-4 ${className}`}>{children}</section>
}

export const inputClass = 'min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink'
export const primaryButton =
  'pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-brand px-4 text-sm font-semibold text-surface disabled:opacity-50'
export const secondaryButton =
  'pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold text-ink disabled:opacity-50'
export const dangerButton =
  'pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-danger px-4 text-sm font-semibold text-danger disabled:opacity-50'

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateFmt.format(new Date(iso)) : '—'
}

export function errorMessage(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Algo deu errado. Tente novamente.'
}

/** Paginação: Anterior / Próxima, página atual e total. */
export function Pager({ page, pageSize, total, onPage, loading }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; loading?: boolean }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null
  const first = (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)
  return (
    <nav aria-label="Paginação" className="flex flex-wrap items-center gap-2 text-sm">
      <button type="button" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)} className={secondaryButton}>Anterior</button>
      <span className="text-ink" aria-live="polite">Página {page} de {pages} · {first}–{last} de {total}</span>
      <button type="button" disabled={page >= pages || loading} onClick={() => onPage(page + 1)} className={secondaryButton}>Próxima</button>
    </nav>
  )
}
