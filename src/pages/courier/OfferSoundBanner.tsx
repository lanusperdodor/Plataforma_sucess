import { BellRing } from 'lucide-react'
import { useEffect, useState } from 'react'
import { enableOfferSound, noticePermission, playOfferBeep } from '../../features/courier/offerAlert.ts'

/**
 * Faixa no topo da Área do entregador enquanto o som dos pedidos não está ativado neste celular.
 * Um toque libera a notificação do celular: daí em diante, cada pedido novo toca e vibra sozinho.
 */
export function OfferSoundBanner() {
  const [perm, setPerm] = useState(noticePermission)
  // já permitido: garante o service worker registrado (mostra a notificação mesmo depois de recarregar)
  useEffect(() => {
    if (perm === 'granted') void navigator.serviceWorker?.register('/sw.js', { scope: '/' }).catch(() => undefined)
  }, [perm])
  if (perm === 'granted') return null
  if (perm === 'denied') {
    return (
      <p role="alert" className="rounded-card border-2 border-danger bg-surface p-4 text-base font-semibold text-danger">
        O som dos pedidos está bloqueado. No Chrome: toque no cadeado ao lado do endereço → Permissões → Notificações → Permitir. Depois recarregue a página.
      </p>
    )
  }
  return (
    <section aria-labelledby="som-pedidos" className="flex flex-col gap-3 rounded-card border-2 border-orange bg-surface p-4">
      <h2 id="som-pedidos" className="flex items-center gap-2 text-lg font-bold text-ink"><BellRing aria-hidden="true" className="size-6" />Ative o som dos pedidos</h2>
      <p className="text-base text-ink-muted">Toque uma vez e permita as notificações. Depois disso, cada pedido novo toca e vibra sozinho, sem você precisar tocar na tela.</p>
      <button type="button" onClick={() => void enableOfferSound().then((p) => { setPerm(p); if (p === 'granted') playOfferBeep() })}
        className="pressable inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-orange px-6 text-lg font-bold text-ink">
        <BellRing aria-hidden="true" className="size-5" />Ativar som dos pedidos
      </button>
    </section>
  )
}
