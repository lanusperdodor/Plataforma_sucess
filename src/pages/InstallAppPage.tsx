import { BellRing, CheckCircle2, Download, MapPin, MoreVertical, PlusSquare, RefreshCw, Share, Smartphone, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Page } from '../components/nav/PageHeader.tsx'
import { runningAsApp } from '../features/app/installed.ts'
import { LEGAL } from '../config/legal.ts'

/** Evento do Chrome/Android que permite mostrar o "Instalar app" no momento certo. */
interface InstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

type Device = 'android' | 'iphone' | 'outro'
export function detectDevice(ua: string): Device {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iphone'
  if (/Android/i.test(ua)) return 'android'
  return 'outro'
}
const PRINTS = [
  { src: '/brand/app/print-01.webp', alt: 'Tudo da sua cidade num app só: tela inicial da Tucaí' },
  { src: '/brand/app/print-02.webp', alt: 'Peça do restaurante da esquina: lista de restaurantes e cardápio' },
  { src: '/brand/app/print-03.webp', alt: 'Veja seu pedido chegando: acompanhamento do pedido' },
  { src: '/brand/app/print-04.webp', alt: 'Corrida nova? O celular apita: corridas para entregadores' },
  { src: '/brand/app/print-05.webp', alt: 'Lojas, serviços e vagas perto de você' },
  { src: '/brand/app/print-06.webp', alt: 'Do comércio da sua cidade para você' },
]
const VANTAGENS = [
  { icon: Zap, t: 'Um toque para abrir', d: 'Ícone na tela do celular e tela cheia, como qualquer app.' },
  { icon: BellRing, t: 'Aviso na hora', d: 'Pedido novo, corrida nova e atualização da entrega.' },
  { icon: MapPin, t: 'Entrega no mapa', d: 'Acompanhe o entregador e trace a rota pelo GPS.' },
  { icon: RefreshCw, t: 'Sempre atualizado', d: 'Novidades chegam sozinhas, sem baixar de novo.' },
]

const btn = 'pressable inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-orange px-7 text-lg font-bold text-ink shadow-[0_10px_30px_rgba(255,85,0,0.35)] disabled:opacity-60 sm:w-auto'

/** Página "Baixe o app": instala a Tucaí pelo próprio site (Android e iPhone), sem loja. */
export function InstallAppPage() {
  const [device] = useState<Device>(() => detectDevice(typeof navigator === 'undefined' ? '' : navigator.userAgent))
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(() => runningAsApp())
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

  const steps = device === 'iphone' ? [
    <>Abra este site no <strong>Safari</strong>.</>,
    <>Toque em <Share aria-label="Compartilhar" className="inline size-5 align-text-bottom" /> <strong>Compartilhar</strong>, embaixo da tela.</>,
    <>Escolha <PlusSquare aria-hidden="true" className="inline size-5 align-text-bottom" /> <strong>Adicionar à Tela de Início</strong> e toque em Adicionar.</>,
  ] : prompt ? [
    <>Toque em <strong>Instalar o app</strong> e confirme.</>,
    <>Pronto: o ícone da Tucaí aparece na tela do celular.</>,
  ] : [
    <>No <strong>Chrome</strong>, toque em <MoreVertical aria-label="menu" className="inline size-5 align-text-bottom" /> (menu, no canto de cima).</>,
    <>Toque em <strong>Instalar app</strong> (ou <strong>Adicionar à tela inicial</strong>).</>,
    <>Pronto: o ícone da Tucaí aparece na tela do celular.</>,
  ]

  return (
    <Page>
      {/* banner */}
      <section aria-labelledby="baixar-titulo" className="relative overflow-hidden rounded-[28px] bg-[#17191B] text-white">
        <span aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-orange/40 blur-3xl" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-20 size-80 rounded-full bg-orange/25 blur-3xl" />
        <div className="relative grid items-center gap-8 p-6 sm:p-8 md:grid-cols-[1.1fr_1fr] md:p-12">
          <div className="flex flex-col gap-5">
            <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/90 ring-1 ring-white/15">
              <Smartphone aria-hidden="true" className="size-4" />App Tucaí · Android e iPhone
            </span>
            <h1 id="baixar-titulo" className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
              Tudo da sua cidade <span className="text-orange">num app só.</span>
            </h1>
            <p className="max-w-md text-base text-white/75 sm:text-lg">
              Peça comida, compre no comércio local, acompanhe a entrega no mapa e, se você é entregador, receba o aviso de corrida nova na hora.
            </p>
            {installed ? (
              <p role="status" className="inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-4 py-3 text-base font-semibold text-white">
                <CheckCircle2 aria-hidden="true" className="size-5 text-orange" />A Tucaí já está instalada neste aparelho.
              </p>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                {device !== 'iphone' && prompt ? (
                  <button type="button" onClick={() => void install()} className={btn}><Download aria-hidden="true" className="size-5" />Instalar o app</button>
                ) : (
                  <a href="#como-instalar" className={btn}><Download aria-hidden="true" className="size-5" />Como instalar</a>
                )}
                <span className="inline-flex items-center gap-2 text-sm text-white/70">Grátis · sem ocupar espaço de loja · sempre atualizado</span>
              </div>
            )}
            <ul className="flex flex-wrap gap-2 text-sm">
              {['Android', 'iPhone', 'Computador'].map((t) => (
                <li key={t} className="rounded-full bg-white/10 px-3 py-1 font-semibold text-white/90 ring-1 ring-white/15">{t}</li>
              ))}
            </ul>
          </div>
          {/* prints em leque */}
          <div aria-hidden="true" className="relative mx-auto h-[360px] w-full max-w-[420px] sm:h-[440px] md:h-[500px]">
            <img src="/brand/app/print-04.webp" alt="" width={540} height={1173} loading="eager"
              className="absolute left-0 top-10 w-[40%] -rotate-6 rounded-[22px] shadow-2xl ring-1 ring-white/10" />
            <img src="/brand/app/print-02.webp" alt="" width={540} height={1173}
              className="absolute right-0 top-10 w-[40%] rotate-6 rounded-[22px] shadow-2xl ring-1 ring-white/10" />
            <img src="/brand/app/print-01.webp" alt="" width={540} height={1173} fetchPriority="high"
              className="absolute left-1/2 top-0 w-[48%] -translate-x-1/2 rounded-[24px] shadow-[0_30px_80px_rgba(255,85,0,0.35)] ring-1 ring-white/15" />
          </div>
        </div>
      </section>

      {/* como instalar */}
      {!installed && (
        <section id="como-instalar" aria-labelledby="instalar" className="scroll-mt-24 rounded-card border border-line bg-surface p-5 md:p-8">
          <h2 id="instalar" className="text-2xl font-bold text-ink">Como instalar {device === 'iphone' ? 'no iPhone' : device === 'android' ? 'no Android' : 'no celular'}</h2>
          <ol className="mt-4 grid gap-3 md:grid-cols-3">
            {steps.map((txt, i) => (
              <li key={i} className="flex items-start gap-3 rounded-2xl bg-muted p-4 text-base text-ink">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-orange font-bold text-ink">{i + 1}</span><span>{txt}</span>
              </li>
            ))}
          </ol>
          {device === 'outro' && <p className="mt-3 text-sm text-ink-muted">No computador, abra este endereço no celular ou instale pelo ícone de instalação na barra de endereço do Chrome/Edge.</p>}
        </section>
      )}

      {/* galeria de prints */}
      <section aria-labelledby="telas" className="flex flex-col gap-4">
        <div>
          <h2 id="telas" className="text-2xl font-bold text-ink">Veja por dentro</h2>
          <p className="text-base text-ink-muted">Pedidos, acompanhamento, entregas e o comércio da sua cidade.</p>
        </div>
        <ul className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 lg:grid-cols-6">
          {PRINTS.map((p) => (
            <li key={p.src} className="w-[62%] shrink-0 snap-center sm:w-[40%] md:w-auto">
              <img src={p.src} alt={p.alt} width={540} height={1173} loading="lazy" className="w-full rounded-[22px] shadow-lg ring-1 ring-line" />
            </li>
          ))}
        </ul>
      </section>

      {/* vantagens */}
      <section aria-labelledby="vantagens" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <h2 id="vantagens" className="sr-only">Com o app você</h2>
        {VANTAGENS.map(({ icon: Icon, t, d }) => (
          <div key={t} className="flex flex-col gap-2 rounded-card border border-line bg-surface p-5">
            <span className="grid size-10 place-items-center rounded-xl bg-orange/15 text-orange"><Icon aria-hidden="true" className="size-5" /></span>
            <p className="text-base font-bold text-ink">{t}</p>
            <p className="text-sm text-ink-muted">{d}</p>
          </div>
        ))}
      </section>
      <p className="text-center text-sm text-ink-muted">
        A Tucaí é instalada direto pelo navegador: não precisa de loja de aplicativos e não ocupa espaço como um app comum.
        {LEGAL.supportContact && <> Dúvidas? <a href={`mailto:${LEGAL.supportContact}`} className="font-semibold underline">{LEGAL.supportContact}</a></>}
      </p>
    </Page>
  )
}
