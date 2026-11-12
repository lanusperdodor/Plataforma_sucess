import { RefreshCw } from 'lucide-react'
import { BRAND } from '../../config/brand.ts'

const etaFmt = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: BRAND.timezone })
  return sameDay ? `hoje, às ${time}` : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: BRAND.timezone })}, às ${time}`
}

/** Página pública de manutenção: sem detalhes técnicos; só a previsão, quando configurada. */
export function MaintenancePage({ eta, onRetry, checking = false }: { eta: string | null; onRetry?: () => void; checking?: boolean }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-muted px-4 py-10">
      <section aria-labelledby="manutencao-titulo" className="flex w-full max-w-md flex-col items-center gap-4 rounded-card border border-line bg-surface p-8 text-center shadow-[var(--shadow-card)]">
        <img src={BRAND.assets.presenter} srcSet={`${BRAND.assets.presenter} 1x, ${BRAND.assets.presenter2x} 2x`} alt={`${BRAND.mascot}, o mascote da ${BRAND.name}`}
             width={200} height={200} className="h-auto w-44 select-none object-contain" />
        <p className="text-sm font-black tracking-[0.3em] text-ink">TUCAÍ</p>
        <h1 id="manutencao-titulo" className="text-2xl font-bold text-ink">Estamos em manutenção!</h1>
        <p className="text-base text-ink">Estamos realizando melhorias para oferecer uma experiência ainda melhor.</p>
        <p className="text-base text-ink-muted">Em breve estaremos de volta.</p>
        {eta && <p className="rounded-full bg-muted px-4 py-1.5 text-sm font-semibold text-ink">Previsão de retorno: {etaFmt(eta)}</p>}
        {onRetry && (
          <button type="button" onClick={onRetry} disabled={checking} className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold text-ink disabled:opacity-50">
            <RefreshCw aria-hidden="true" className={`size-4 ${checking ? 'animate-spin' : ''}`} />Verificar novamente
          </button>
        )}
      </section>
    </main>
  )
}
