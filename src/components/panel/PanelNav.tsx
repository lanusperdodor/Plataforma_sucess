import { ChevronDown, Menu, PanelLeftClose, PanelLeftOpen, X, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

/**
 * Navegação padrão dos painéis (Master, Gestão, entregador): barra lateral agrupada no computador, recolhível só aos
 * ícones; gaveta com o mesmo conteúdo no celular/tablet. Ícones discretos e um único destaque (laranja Tucaí) no item ativo.
 * Só organiza a navegação: quem decide o acesso é o banco (RLS e funções). Esconder um item não protege nada.
 */
export interface PanelNavItem { to: string; label: string; icon: LucideIcon; end?: boolean; hint?: string; badge?: ReactNode }
export interface PanelNavGroup { id: string; label: string; items: PanelNavItem[] }

const STORAGE_KEY = 'tucai:painel-menu'
type Saved = { collapsed?: boolean; closed?: Record<string, string[]> }
function load(): Saved {
  try { return JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '{}') as Saved } catch { return {} }
}
function save(next: Saved) {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* sem armazenamento: só não lembra */ }
}

function NavList({ groups, scope, collapsed = false, onNavigate, label }: { groups: PanelNavGroup[]; scope: string; collapsed?: boolean; onNavigate?: () => void; label: string }) {
  const { pathname } = useLocation()
  const [closed, setClosed] = useState<string[]>(() => load().closed?.[scope] ?? [])
  const toggle = (id: string) => setClosed((cur) => {
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    const s = load()
    save({ ...s, closed: { ...(s.closed ?? {}), [scope]: next } })
    return next
  })
  const visible = groups.filter((g) => g.items.length > 0)
  return (
    <nav aria-label={label} className="flex flex-col gap-1">
      {visible.map((g, gi) => {
        // o grupo da página atual nunca fica fechado
        const hasActive = g.items.some((i) => (i.end ? pathname === i.to : pathname === i.to || pathname.startsWith(`${i.to}/`)))
        const isOpen = collapsed || hasActive || !closed.includes(g.id)
        const single = g.items.length === 1 && visible.length > 1 && gi === 0
        return (
          <div key={g.id} className={gi > 0 ? 'pt-1' : ''}>
            {collapsed ? (
              gi > 0 && <span aria-hidden="true" className="mx-3 my-2 block h-px bg-line" />
            ) : single ? null : (
              <button
                type="button"
                onClick={() => toggle(g.id)}
                aria-expanded={isOpen}
                className="flex min-h-9 w-full items-center justify-between rounded-lg px-3 text-xs font-semibold text-ink-muted hover:text-ink"
              >
                {g.label}
                <ChevronDown aria-hidden="true" className={`size-3.5 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
              </button>
            )}
            {isOpen && (
              <ul className="flex flex-col gap-0.5">
                {g.items.map((i) => (
                  <li key={i.to}>
                    <NavLink
                      to={i.to}
                      end={i.end}
                      onClick={onNavigate}
                      title={collapsed ? i.label : i.hint}
                      className={({ isActive }) =>
                        `group relative flex min-h-10 items-center gap-3 rounded-lg text-sm outline-offset-[-2px] transition-colors ${collapsed ? 'justify-center px-0' : 'px-3'} ${
                          isActive ? 'bg-muted font-semibold text-ink' : 'font-medium text-ink-muted hover:bg-muted/70 hover:text-ink'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-orange" />}
                          <i.icon aria-hidden="true" className={`size-[18px] shrink-0 ${isActive ? 'text-ink' : ''}`} strokeWidth={isActive ? 2.25 : 1.75} />
                          {collapsed ? <span className="sr-only">{i.label}</span> : <span className="min-w-0 flex-1 truncate">{i.label}</span>}
                          {!collapsed && i.badge}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </nav>
  )
}

/** Barra lateral fixa (lg+). `top` = altura do cabeçalho do painel. */
export function PanelSidebar({ groups, scope, label, top = '3.5rem', footer }: { groups: PanelNavGroup[]; scope: string; label: string; top?: string; footer?: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => !!load().collapsed)
  const toggle = () => setCollapsed((v) => { save({ ...load(), collapsed: !v }); return !v })
  return (
    <aside className={`sticky hidden shrink-0 flex-col border-r border-line bg-surface lg:flex ${collapsed ? 'w-16' : 'w-60 2xl:w-64'}`} style={{ top, height: `calc(100dvh - ${top})` }}>
      <div className="flex-1 overflow-y-auto p-2 [scrollbar-width:thin]"><NavList groups={groups} scope={scope} collapsed={collapsed} label={label} /></div>
      {footer && !collapsed && <div className="border-t border-line p-2">{footer}</div>}
      <button type="button" onClick={toggle} aria-expanded={!collapsed} className={`flex min-h-11 items-center gap-2 border-t border-line px-4 text-sm font-medium text-ink-muted hover:bg-muted hover:text-ink ${collapsed ? 'justify-center' : ''}`}>
        {collapsed ? <PanelLeftOpen aria-hidden="true" className="size-[18px]" /> : <PanelLeftClose aria-hidden="true" className="size-[18px]" />}
        {collapsed ? <span className="sr-only">Expandir menu</span> : 'Recolher menu'}
      </button>
    </aside>
  )
}

/** Botão ☰ (só abaixo de lg). */
export function PanelMenuButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} aria-label="Abrir menu" className="pressable grid size-11 shrink-0 place-items-center rounded-full text-ink hover:bg-muted lg:hidden">
      <Menu aria-hidden="true" className="size-6" />
    </button>
  )
}

/** Gaveta do celular/tablet: fecha com Esc, no fundo, ao navegar; devolve o foco ao botão. */
export function PanelDrawer({ open, onClose, groups, scope, label, title, footer }: {
  open: boolean; onClose: () => void; groups: PanelNavGroup[]; scope: string; label: string; title: ReactNode; footer?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('[aria-current="page"], a, button')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; prev?.focus?.() }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[var(--z-sheet)] lg:hidden">
      <button type="button" aria-label="Fechar menu" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={label} className="absolute inset-y-0 left-0 flex w-[min(18rem,86vw)] flex-col bg-surface shadow-[var(--shadow-card)]">
        <div className="flex min-h-14 items-center justify-between gap-2 border-b border-line px-3">
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">{title}</span>
          <button type="button" onClick={onClose} className="pressable grid size-11 place-items-center rounded-full text-ink hover:bg-muted" aria-label="Fechar menu"><X aria-hidden="true" className="size-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-2"><NavList groups={groups} scope={scope} onNavigate={onClose} label={label} /></div>
        {footer && <div className="border-t border-line p-2">{footer}</div>}
      </div>
    </div>
  )
}

/** Estado da gaveta: fecha sozinha ao trocar de página. */
export function usePanelDrawer() {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const { pathname } = useLocation()
  useEffect(() => setOpen(false), [pathname])
  return { open, setOpen, close }
}
