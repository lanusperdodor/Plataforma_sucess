import { useCallback, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { prefetchRoute } from '../../app/lazy.ts'
import { useScrollRestoration } from '../../app/useScrollRestoration.ts'
import { AnnounceContext } from './announceContext.ts'
import { BottomNav } from './BottomNav.tsx'
import { CartFab } from './CartFab.tsx'
import { LocationPicker } from './LocationPicker.tsx'
import { SideNav } from './SideNav.tsx'
import { TopBar } from './TopBar.tsx'
import { useBreakpoint } from './useBreakpoint.ts'
import { useCartSummary } from './useShellData.ts'

export type AppShellProps = {
  children?: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const layout = useBreakpoint()
  const navigate = useNavigate()
  const cart = useCartSummary()
  const [message, setMessage] = useState('')
  useScrollRestoration()

  const announce = useCallback((text: string) => {
    // Limpa antes para que repetir a mesma mensagem seja lido de novo.
    setMessage('')
    window.setTimeout(() => setMessage(text), 50)
  }, [])

  const mobile = layout === 'mobile'
  const desktop = layout === 'desktop'

  return (
    <AnnounceContext.Provider value={announce}>
      <div className="min-w-0 overflow-x-clip">
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[var(--z-toast)] focus:rounded-xl focus:bg-brand focus:px-4 focus:py-3 focus:font-semibold focus:text-surface"
        >
          Pular para o conteúdo
        </a>
        <TopBar layout={layout} location={<LocationPicker />} />
        <div className="flex min-w-0">
          {mobile ? null : <SideNav mode={desktop ? 'expanded' : 'rail'} onPrefetch={prefetchRoute} />}
          <main
            id="conteudo"
            tabIndex={-1}
            className="min-w-0 flex-1 outline-none"
            style={
              mobile
                ? { paddingBottom: 'calc(var(--bottom-nav-h) + env(safe-area-inset-bottom))' }
                : undefined
            }
          >
            {desktop ? (
              <div className="mx-auto w-full min-w-0 max-w-[var(--content-max)]">{children}</div>
            ) : (
              children
            )}
          </main>
        </div>
        {mobile ? (
          <>
            <BottomNav onPrefetch={prefetchRoute} />
            <CartFab count={cart.count} totalCents={cart.totalCents} onOpen={() => navigate('/sacola')} />
          </>
        ) : null}
        <div aria-live="polite" role="status" className="sr-only" data-testid="announcer">
          {message}
        </div>
      </div>
    </AnnounceContext.Provider>
  )
}
