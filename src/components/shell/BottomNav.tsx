import { Link, useLocation } from 'react-router-dom'
import { NAV_DESTINATIONS, resolveActiveDestination } from './destinations.ts'

export type BottomNavProps = {
  /** Prefetch do chunk da rota em hover/foco. */
  onPrefetch?: (to: string) => void
}

export function BottomNav({ onPrefetch }: BottomNavProps) {
  const { pathname } = useLocation()
  const active = resolveActiveDestination(pathname)

  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 border-t border-line bg-surface"
      style={{
        zIndex: 'var(--z-nav)',
        height: 'calc(var(--bottom-nav-h) + env(safe-area-inset-bottom))',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <ul className="m-0 grid h-full list-none grid-cols-5 p-0">
        {NAV_DESTINATIONS.map((item) => {
          const isActive = item.id === active
          const Icon = item.icon
          return (
            <li key={item.id} className="min-w-0">
              <Link
                to={item.to}
                aria-current={isActive ? 'page' : undefined}
                onPointerEnter={() => onPrefetch?.(item.to)}
                onFocus={() => onPrefetch?.(item.to)}
                className={`pressable flex h-full min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 text-[0.6875rem] leading-none no-underline ${
                  isActive ? 'font-bold text-brand' : 'font-medium text-ink-muted'
                }`}
              >
                <span
                  className={`flex h-7 w-12 items-center justify-center rounded-full ${
                    isActive ? 'bg-muted' : 'bg-transparent'
                  }`}
                >
                  <Icon aria-hidden="true" size={20} strokeWidth={isActive ? 2.25 : 1.75} />
                </span>
                <span className="max-w-full truncate px-1">{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
