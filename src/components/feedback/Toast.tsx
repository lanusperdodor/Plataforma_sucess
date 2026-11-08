import { X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ToastContext } from './toast-context.ts'
import type { ToastApi, ToastKind } from './toast-context.ts'

export const MAX_TOASTS = 3
export const DURATION_MS: Record<ToastKind, number> = { success: 5000, info: 5000, error: 8000 }

interface ToastData {
  id: number
  kind: ToastKind
  message: string
}

const KIND_CLASS: Record<ToastKind, string> = {
  success: 'border-success text-ink',
  info: 'border-line text-ink',
  error: 'border-danger text-danger',
}

function ToastItem({ toast, onClose }: { toast: ToastData; onClose: (id: number) => void }) {
  const [entered, setEntered] = useState(false)
  const remaining = useRef(DURATION_MS[toast.kind])
  const startedAt = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hovered = useRef(false)
  const focused = useRef(false)
  const { id } = toast

  const start = useCallback(() => {
    startedAt.current = Date.now()
    timer.current = setTimeout(() => onClose(id), remaining.current)
  }, [id, onClose])

  const pause = useCallback(() => {
    if (timer.current === undefined) return
    clearTimeout(timer.current)
    timer.current = undefined
    remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current))
  }, [])

  const resume = useCallback(() => {
    if (timer.current === undefined && !hovered.current && !focused.current) start()
  }, [start])

  useEffect(() => {
    start()
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => {
      clearTimeout(timer.current)
      cancelAnimationFrame(raf)
    }
  }, [start])

  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => {
        hovered.current = true
        pause()
      }}
      onMouseLeave={() => {
        hovered.current = false
        resume()
      }}
      onFocus={() => {
        focused.current = true
        pause()
      }}
      onBlur={() => {
        focused.current = false
        resume()
      }}
      className={`pointer-events-auto flex w-full items-start gap-2 rounded-xl border bg-surface p-3 text-sm shadow-lg transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ${
        entered ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      } ${KIND_CLASS[toast.kind]}`}
    >
      <p className="min-w-0 flex-1 break-words">{toast.message}</p>
      <button
        type="button"
        aria-label="Fechar notificação"
        onClick={() => onClose(id)}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-muted -m-2"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const show = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++
    setToasts((list) => [...list, { id, kind, message }].slice(-MAX_TOASTS))
    return id
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m) => show('success', m),
      info: (m) => show('info', m),
      error: (m) => show('error', m),
      dismiss,
    }),
    [show, dismiss],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        data-testid="toast-region"
        className="pointer-events-none fixed inset-x-3 bottom-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom)+0.75rem)] z-[var(--z-toast)] flex flex-col gap-2 md:inset-x-auto md:right-4 md:bottom-4 md:w-96"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
