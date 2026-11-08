import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export interface StateShellProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  tone?: 'brand' | 'warm'
  role?: 'alert' | 'status'
}

/** Estrutura visual compartilhada pelos estados vazio/erro/não encontrado. */
export function StateShell({ icon: Icon, title, description, action, tone = 'brand', role }: StateShellProps) {
  const toneClass = tone === 'warm' ? 'bg-warm-soft text-warm' : 'bg-muted text-brand'
  return (
    <div
      role={role}
      className="mx-auto flex w-full max-w-md flex-col items-center gap-3 rounded-card border border-line bg-surface px-6 py-10 text-center shadow-[var(--shadow-card)]"
    >
      <span className={`flex size-14 items-center justify-center rounded-full ${toneClass}`}>
        <Icon aria-hidden="true" className="size-7" />
      </span>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {description ? <p className="text-sm text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export const stateButtonClass =
  'pressable inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-5 text-sm font-semibold text-surface'
