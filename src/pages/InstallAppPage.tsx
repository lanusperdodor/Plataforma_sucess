import { CheckCircle2, Download, MoreVertical, PlusSquare, Share, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'

/** Evento do Chrome/Android que permite mostrar o "Instalar app" no momento certo. */
interface InstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

type Device = 'android' | 'iphone' | 'outro'
export function detectDevice(ua: string): Device {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iphone'
  if (/Android/i.test(ua)) return 'android'
  return 'outro'
}
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true || /TucaiApp\//.test(navigator.userAgent)

const btn = 'pressable inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-orange px-6 text-lg font-bold text-ink disabled:opacity-60 sm:w-auto'

/** Página "Baixe o app": instala a Tucaí pelo próprio site (Android e iPhone), sem loja. */
export function InstallAppPage() {
  const [device] = useState<Device>(() => detectDevice(typeof navigator === 'undefined' ? '' : navigator.userAgent))
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(() => typeof window !== 'undefined' && isStandalone())
  useEffect(() => {
    void navigator.serviceWorker?.register('/sw.js', { scope: '/' }).catch(() => undefined)
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as InstallPromptEvent) }
    const onInstalled = () => { setInstalled(true); setPrompt(null) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled) }
  }, [])

  const install = async () => {
    if (!prompt) return
    await prompt.prompt()
    const r = await prompt.userChoice
    if (r.outcome === 'accepted') setInstalled(true)
    setPrompt(null)
  }

  return (
    <Page>
      <PageHeader icon={Smartphone} title="Baixe o app da Tucaí" subtitle="Android e iPhone. Grátis, direto do site, sem ocupar espaço de loja." />
      {installed ? (
        <p role="status" className="flex items-center gap-2 rounded-card border border-line bg-surface p-4 text-base font-semibold text-success">
          <CheckCircle2 aria-hidden="true" className="size-5" />A Tucaí já está instalada neste celular. Abra pelo ícone na tela inicial.
        </p>
      ) : (
        <section aria-labelledby="instalar" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 md:p-6">
          <h2 id="instalar" className="text-xl font-bold text-ink">{device === 'iphone' ? 'No iPhone' : device === 'android' ? 'No Android' : 'No celular'}</h2>
          {device !== 'iphone' && prompt && (
            <button type="button" onClick={() => void install()} className={btn}><Download aria-hidden="true" className="size-5" />Instalar o app</button>
          )}
          {device === 'iphone' ? (
            <ol className="flex flex-col gap-3 text-base text-ink">
              <li className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand font-bold text-surface">1</span><span>Abra este site no <strong>Safari</strong>.</span></li>
              <li className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand font-bold text-surface">2</span><span>Toque em <Share aria-label="Compartilhar" className="inline size-5 align-text-bottom" /> <strong>Compartilhar</strong>, embaixo da tela.</span></li>
              <li className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand font-bold text-surface">3</span><span>Escolha <PlusSquare aria-hidden="true" className="inline size-5 align-text-bottom" /> <strong>Adicionar à Tela de Início</strong> e toque em Adicionar.</span></li>
            </ol>
          ) : (
            <ol className="flex flex-col gap-3 text-base text-ink">
              {!prompt && <li className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand font-bold text-surface">1</span><span>No <strong>Chrome</strong>, toque em <MoreVertical aria-label="menu" className="inline size-5 align-text-bottom" /> (menu, no canto de cima).</span></li>}
              {!prompt && <li className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand font-bold text-surface">2</span><span>Toque em <strong>Instalar app</strong> (ou <strong>Adicionar à tela inicial</strong>).</span></li>}
              <li className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand font-bold text-surface">{prompt ? 1 : 3}</span><span>Pronto: o ícone da Tucaí aparece na tela do celular, como qualquer aplicativo.</span></li>
            </ol>
          )}
        </section>
      )}
      <section aria-labelledby="vantagens" className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4 md:p-6">
        <h2 id="vantagens" className="text-lg font-semibold text-ink">Com o app você</h2>
        <ul className="list-disc space-y-1 pl-5 text-base text-ink-muted">
          <li>abre a Tucaí com um toque, em tela cheia;</li>
          <li>recebe o aviso de pedido novo e de corrida nova (entregadores);</li>
          <li>acompanha a entrega no mapa e usa o GPS para traçar a rota;</li>
          <li>sempre está na versão mais nova, sem precisar atualizar.</li>
        </ul>
        <p className="text-sm text-ink-muted">Em breve também na Google Play e na App Store.</p>
      </section>
    </Page>
  )
}
