import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type OverlayVariant = 'dialog' | 'sheet-bottom' | 'sheet-right'

export interface OverlayBaseProps {
  open: boolean
  onClose: () => void
  /** Título obrigatório: nomeia o diálogo via aria-labelledby. */
  title: ReactNode
  children?: ReactNode
  /** Clique no backdrop fecha (padrão: true). */
  closeOnBackdrop?: boolean
  /** Classes extras para o painel. */
  className?: string
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

// Contadores compartilhados entre overlays empilhados.
let inertCount = 0
let lockCount = 0
let savedOverflow = ''

function lockPage() {
  const root = document.getElementById('root')
  if (inertCount++ === 0) root?.setAttribute('inert', '')
  if (lockCount++ === 0) {
    savedOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
}

function unlockPage() {
  if (--inertCount === 0) document.getElementById('root')?.removeAttribute('inert')
  if (--lockCount === 0) document.body.style.overflow = savedOverflow
}

const PANEL: Record<OverlayVariant, string> = {
  dialog:
    'overlay-panel-center relative m-auto w-[calc(100%-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] rounded-card',
  'sheet-bottom':
    'overlay-panel-bottom relative mt-auto w-full max-h-[90dvh] rounded-t-card pb-[env(safe-area-inset-bottom)] sm:mx-auto sm:max-w-lg',
  'sheet-right':
    'overlay-panel-right relative ml-auto h-full w-full max-w-md pb-[env(safe-area-inset-bottom)]',
}

function OverlayInner({
  onClose,
  title,
  children,
  closeOnBackdrop = true,
  className = '',
  variant,
}: Omit<OverlayBaseProps, 'open'> & { variant: OverlayVariant }) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  // Valor inicial avaliado na primeira renderização: o disparador original.
  const opener = useRef<Element | null>(document.activeElement)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useLayoutEffect(() => {
    lockPage()
    const panel = panelRef.current
    if (panel && !panel.contains(document.activeElement)) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? panel).focus()
    }
    const target = opener.current
    return () => {
      unlockPage()
      if (target instanceof HTMLElement && target.isConnected) target.focus()
    }
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onCloseRef.current()
      return
    }
    if (e.key !== 'Tab') return
    const panel = panelRef.current
    if (!panel) return
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (items.length === 0) {
      e.preventDefault()
      panel.focus()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) return
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    } else if (!panel.contains(active)) {
      e.preventDefault()
      first.focus()
    }
  }

  const wrapper =
    variant === 'dialog' ? 'items-center justify-center' : variant === 'sheet-right' ? '' : 'items-end'

  return (
    <div
      className="fixed inset-0 flex"
      style={{ zIndex: 'var(--z-sheet)' }}
      onKeyDown={handleKeyDown}
    >
      <div
        className="overlay-backdrop absolute inset-0 bg-ink/50"
        data-testid="overlay-backdrop"
        aria-hidden="true"
        onClick={() => {
          if (closeOnBackdrop) onCloseRef.current()
        }}
      />
      <div className={`pointer-events-none relative flex w-full ${wrapper}`}>
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={`${PANEL[variant]} pointer-events-auto flex flex-col overflow-y-auto bg-surface text-ink shadow-xl outline-none ${className}`}
        >
          <h2 id={titleId} className="px-4 pt-4 text-lg font-semibold">
            {title}
          </h2>
          {children}
        </div>
      </div>
    </div>
  )
}

export function Overlay({ open, variant, ...rest }: OverlayBaseProps & { variant: OverlayVariant }) {
  if (!open) return null
  return createPortal(<OverlayInner variant={variant} {...rest} />, document.body)
}
