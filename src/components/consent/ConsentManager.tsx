import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { readTrackingConfig, trackingConfigured } from '../../features/tracking/config.ts'
import { saveConsent, useConsent } from '../../features/tracking/consentStore.ts'
import { applyConsent, trackPageView } from '../../features/tracking/tracker.ts'

/** Evento para reabrir as preferências (ex.: botão na página de cookies). */
export const OPEN_CONSENT_EVENT = 'tucai:consent:open'
export const openConsentPreferences = () => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT))

const btn = 'pressable inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-semibold'

/**
 * Aplica a escolha de cookies (carrega GA4/Pixel só com aceite) e mostra o aviso quando
 * existe alguma ferramenta configurada e a pessoa ainda não escolheu. Recusar não bloqueia nada.
 */
export function ConsentManager() {
  const config = useMemo(() => readTrackingConfig(), [])
  const consent = useConsent()
  const { pathname, search } = useLocation()
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  const [marketing, setMarketing] = useState(false)

  useEffect(() => {
    applyConsent(config, consent)
    // ao aceitar, registra a página atual (as próximas entram pela navegação)
    if (consent) trackPageView(pathname + search, document.title)
  }, [config, consent]) // eslint-disable-line react-hooks/exhaustive-deps -- page_view da navegação fica no RouteMeta

  useEffect(() => {
    const onOpen = () => {
      setAnalytics(consent?.analytics ?? false)
      setMarketing(consent?.marketing ?? false)
      setCustom(true)
      setOpen(true)
    }
    window.addEventListener(OPEN_CONSENT_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, onOpen)
  }, [consent])

  if (!trackingConfigured(config)) return null
  if (consent && !open) return null

  const decide = (a: boolean, m: boolean) => {
    saveConsent({ analytics: Boolean(config.ga4) && a, marketing: Boolean(config.pixel) && m })
    setOpen(false)
    setCustom(false)
  }

  return (
    <section
      role="region"
      aria-label="Preferências de cookies"
      className="fixed inset-x-2 bottom-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom)+0.5rem)] z-[var(--z-toast)] rounded-card border border-line bg-surface p-4 shadow-[var(--shadow-card)] md:inset-x-auto md:bottom-4 md:right-4 md:max-w-md"
    >
      <h2 className="text-base font-semibold text-ink">Sua privacidade</h2>
      <p className="mt-1 text-sm text-ink">
        Os cookies necessários estão sempre ativos. Com a sua permissão, usamos também
        {config.ga4 ? ' estatísticas de uso (Google Analytics)' : ''}
        {config.ga4 && config.pixel ? ' e' : ''}
        {config.pixel ? ' medição de anúncios (Meta)' : ''}. Você pode mudar quando quiser.{' '}
        <Link to="/armazenamento" className="font-semibold text-brand underline">Saiba mais</Link>
      </p>
      {custom && (
        <fieldset className="mt-3 flex flex-col gap-2 text-sm">
          <legend className="sr-only">Escolha por categoria</legend>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5" checked disabled />Necessários (sempre ativos)</label>
          {config.ga4 && (
            <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} />Estatísticas de uso (Google Analytics)</label>
          )}
          {config.pixel && (
            <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />Marketing e anúncios (Meta Pixel)</label>
          )}
        </fieldset>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {custom ? (
          <button type="button" onClick={() => decide(analytics, marketing)} className={`${btn} bg-brand text-surface`}>Salvar escolha</button>
        ) : (
          <>
            <button type="button" onClick={() => decide(true, true)} className={`${btn} bg-brand text-surface`}>Aceitar todos</button>
            <button type="button" onClick={() => decide(false, false)} className={`${btn} border border-line text-ink`}>Recusar</button>
            <button type="button" onClick={() => setCustom(true)} className={`${btn} text-ink underline`}>Personalizar</button>
          </>
        )}
      </div>
    </section>
  )
}
