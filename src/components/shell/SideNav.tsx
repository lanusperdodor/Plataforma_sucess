import { Menu, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  NAV_DESTINATIONS,
  SECONDARY_DESTINATIONS,
  resolveActiveDestination,
} from './destinations.ts'

export type SideNavProps = {
  mode: 'rail' | 'expanded'
  onPrefetch?: (to: string) => void
}

const stickyStyle = {
  top: 'var(--header-h-compact)',
  height: 'calc(100dvh - var(--header-h-compact))',
}

export function SideNav({ mode, onPrefetch }: SideNavProps) {
  const { pathname } = useLocation()
  const active = resolveActiveDestination(pathname)
  const [open, setOpen] = useState(false)
  const rail = mode === 'rail'
  const drawerOpen = rail && open

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const itemClass = (isActive: boolean, showLabel: boolean) =>
    `pressable flex min-h-11 min-w-11 items-center gap-3 rounded-xl px-3 no-underline ${
      showLabel ? '' : 'justify-center'
    } ${isActive ? 'bg-muted font-bold text-brand' : 'font-medium text-ink-muted'}`

  const primary = (showLabel: boolean) =>
    NAV_DESTINATIONS.map((item) => {
      const isActive = item.id === active
      const Icon = item.icon
      return (
        <li key={item.id}>
          <Link
            to={item.to}
            aria-current={isActive ? 'page' : undefined}
            aria-label={showLabel ? undefined : item.label}
            title={showLabel ? undefined : item.label}
            onPointerEnter={() => onPrefetch?.(item.to)}
            onFocus={() => onPrefetch?.(item.to)}
            className={itemClass(isActive, showLabel)}
          >
            <Icon aria-hidden="true" size={20} strokeWidth={isActive ? 2.5 : 2} />
            {showLabel ? <span>{item.label}</span> : null}
          </Link>
        </li>
      )
    })

  const secondary = () =>
    SECONDARY_DESTINATIONS.map((item) => {
      const Icon = item.icon
      const isCurrent = pathname === item.to || pathname.startsWith(`${item.to}/`)
      return (
        <li key={item.id}>
          <Link
            to={item.to}
            aria-current={isCurrent ? 'page' : undefined}
            onPointerEnter={() => onPrefetch?.(item.to)}
            onFocus={() => onPrefetch?.(item.to)}
            className={itemClass(isCurrent, true)}
          >
            <Icon aria-hidden="true" size={20} />
            <span>{item.label}</span>
          </Link>
        </li>
      )
    })

  if (!rail) {
    return (
      <nav
        aria-label="Menu lateral"
        className="sticky shrink-0 overflow-y-auto border-r border-line bg-surface p-3"
        style={{ ...stickyStyle, width: 'var(--sidenav-w)', zIndex: 'var(--z-nav)' }}
      >
        <ul className="m-0 flex list-none flex-col gap-1 p-0">{primary(true)}</ul>
        <h2 className="mx-3 mb-2 mt-6 text-xs font-bold uppercase tracking-wide text-ink-muted">
          Descobrir
        </h2>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">{secondary()}</ul>
      </nav>
    )
  }

  return (
    <>
      <nav
        aria-label="Menu lateral"
        className="sticky shrink-0 overflow-y-auto border-r border-line bg-surface p-3"
        style={{ ...stickyStyle, width: 'var(--sidenav-w-rail)', zIndex: 'var(--z-nav)' }}
      >
        <button
          type="button"
          aria-label="Expandir menu"
          aria-expanded={drawerOpen}
          onClick={() => setOpen(true)}
          className="pressable mb-2 flex min-h-11 w-full min-w-11 items-center justify-center rounded-xl border-0 bg-transparent text-ink-muted"
        >
          <Menu aria-hidden="true" size={20} />
        </button>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">{primary(false)}</ul>
      </nav>

      <div
        aria-hidden="true"
        onClick={() => setOpen(false)}
        className="fixed inset-0 bg-ink transition-opacity"
        style={{
          zIndex: 'var(--z-sheet)',
          opacity: drawerOpen ? 0.4 : 0,
          pointerEvents: drawerOpen ? 'auto' : 'none',
        }}
      />
      <aside
        aria-label="Menu expandido"
        aria-hidden={!drawerOpen}
        {...({ inert: drawerOpen ? undefined : '' } as Record<string, unknown>)}
        className="fixed bottom-0 left-0 top-0 overflow-y-auto bg-surface p-3 transition-transform"
        style={{
          zIndex: 'var(--z-sheet)',
          width: 'var(--sidenav-w)',
          transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
          transitionDuration: 'var(--motion-base)',
          boxShadow: drawerOpen ? 'var(--shadow-card)' : 'none',
        }}
      >
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setOpen(false)}
          className="pressable mb-2 flex min-h-11 min-w-11 items-center justify-center rounded-xl border-0 bg-transparent text-ink-muted"
        >
          <X aria-hidden="true" size={20} />
        </button>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">{primary(true)}</ul>
        <h2 className="mx-3 mb-2 mt-6 text-xs font-bold uppercase tracking-wide text-ink-muted">
          Descobrir
        </h2>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">{secondary()}</ul>
      </aside>
    </>
  )
}
