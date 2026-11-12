import { Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { BRAND } from '../../config/brand.ts'
import { usePrefersReducedMotion } from '../../lib/a11y.ts'
import { keyCheckerboard } from './checkerKey.ts'

/**
 * Mídia do apresentador: PNG (padrão), GIF ou vídeo. O balão HTML é único e some quando a mídia
 * já traz o balão embutido (`hasBakedBubble`), para não duplicar a fala.
 */
export type PresenterMedia =
  | { kind: 'image'; src: string; srcSet?: string }
  | { kind: 'gif'; src: string; staticSrc: string; hasBakedBubble?: boolean }
  | { kind: 'video'; src: string; poster: string; hasBakedBubble?: boolean; width?: number; height?: number }
  | { kind: 'animation'; src: string; poster: string; hasBakedBubble?: boolean }

/** PNG estático (movimento reduzido e fallback). */
export const STATIC_PRESENTER: PresenterMedia = {
  kind: 'image',
  src: BRAND.assets.presenter,
  srcSet: ` 600w,  1217w`,
}

export const DEFAULT_PRESENTER: PresenterMedia = BRAND.assets.presenterAnimation.enabled
  ? {
      kind: 'animation',
      src: BRAND.assets.presenterAnimation.src,
      poster: BRAND.assets.presenterAnimation.poster,
      hasBakedBubble: BRAND.assets.presenterAnimation.hasBakedBubble,
    }
  : BRAND.assets.presenterVideo.enabled
  ? {
      kind: 'video',
      src: BRAND.assets.presenterVideo.src,
      poster: BRAND.assets.presenter,
      hasBakedBubble: BRAND.assets.presenterVideo.hasBakedBubble,
      width: 1280,
      height: 720,
    }
  : {
      kind: 'image',
      src: BRAND.assets.presenter,
      srcSet: `${BRAND.assets.presenter} 600w, ${BRAND.assets.presenter2x} 1217w`,
    }

/** Proporção do PNG (1217 × 1292): reservada para não haver salto de layout. */
const WIDTH = 600
const HEIGHT = 637
const ALT = `${BRAND.mascot}, o tucano mascote do ${BRAND.name}, de corpo inteiro, apresentando a plataforma`
// React 18 não tipa fetchPriority; repassado ao DOM em minúsculas.
const HIGH_PRIORITY: Record<string, string> = { fetchpriority: 'high' }
const MEDIA_CLASS = 'block h-auto w-full select-none object-contain'

/** `play()` pode lançar/rejeitar (autoplay bloqueado) ou nem devolver Promise. */
function safePlay(v: HTMLVideoElement, onBlocked: () => void): void {
  try {
    const r = v.play() as Promise<void> | undefined
    if (r && typeof r.catch === 'function') r.catch(onBlocked)
  } catch {
    onBlocked()
  }
}

/** Resolução do recorte (metade de 1280×720: leve e nítido no tamanho exibido). */
const KEY_W = 640
const KEY_H = 360
/** Marca d'água no canto inferior direito do quadro. */
const WATERMARK = [{ x: 556, y: 326, w: 84, h: 34 }] as const

/**
 * Vídeo do Tuca desenhado num canvas sem o xadrez de fundo. Mudo, em loop, inline,
 * autoplay quando permitido e pausa acessível. Movimento reduzido: o pai mostra o PNG estático.
 */
function PresenterVideo({ media }: { media: Extract<PresenterMedia, { kind: 'video' }> }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [playing, setPlaying] = useState(false)
  // o vídeo (1,7 MB) só começa a baixar depois da página carregada: não disputa a rede com o app
  const [src, setSrc] = useState<string | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    const start = () => {
      if (!cancelled) setSrc(media.src)
    }
    const idle = (cb: () => void) => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(cb, { timeout: 2000 })
      else globalThis.setTimeout(cb, 300)
    }
    if (document.readyState === 'complete') idle(start)
    else window.addEventListener('load', () => idle(start), { once: true })
    return () => {
      cancelled = true
    }
  }, [media.src])

  useEffect(() => {
    if (!src) return
    const v = videoRef.current
    let out: CanvasRenderingContext2D | null = null
    try {
      out = canvasRef.current?.getContext('2d', { willReadFrequently: true }) ?? null
    } catch {
      out = null // ambiente sem canvas (testes)
    }
    if (!v) return
    safePlay(v, () => setPlaying(false))
    if (!out) return
    const ctx = out
    let stop = false
    let handle = 0
    const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback
    let last = 0
    const draw = () => {
      if (stop) return
      // recorte do fundo quadro a quadro custa CPU: ~15 quadros/s bastam e preservam a resposta ao toque
      const now = performance.now()
      if (v.readyState >= 2 && now - last >= 66) {
        last = now
        ctx.clearRect(0, 0, KEY_W, KEY_H)
        ctx.drawImage(v, 0, 0, KEY_W, KEY_H)
        const frame = ctx.getImageData(0, 0, KEY_W, KEY_H)
        keyCheckerboard(frame.data, KEY_W, KEY_H, { clear: WATERMARK, floorY: 318 })
        ctx.putImageData(frame, 0, 0)
      }
      handle = rvfc ? rvfc.call(v, draw) : requestAnimationFrame(draw)
    }
    v.addEventListener('loadeddata', draw, { once: true })
    if (v.readyState >= 2) draw()
    return () => {
      stop = true
      v.removeEventListener('loadeddata', draw)
      if (!rvfc) cancelAnimationFrame(handle)
    }
  }, [src])

  return (
    <div className="relative">
      <video
        ref={videoRef}
        src={src}
        muted
        loop
        playsInline
        autoPlay
        preload="auto"
        aria-hidden="true"
        tabIndex={-1}
        className="pointer-events-none absolute left-0 top-0 size-px opacity-0"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <canvas
        ref={canvasRef}
        width={KEY_W}
        height={KEY_H}
        role="img"
        aria-label={ALT}
        data-testid="tuca-canvas"
        className="block aspect-video h-auto w-full"
      />
      <button
        type="button"
        onClick={() => {
          const v = videoRef.current
          if (!v) return
          if (v.paused) safePlay(v, () => setPlaying(false))
          else v.pause()
        }}
        aria-label={playing ? 'Pausar animação do Tuca' : 'Reproduzir animação do Tuca'}
        className="pressable absolute bottom-1 right-1 inline-flex size-11 items-center justify-center rounded-full bg-surface/90 text-ink shadow-[var(--shadow-card)]"
      >
        {playing ? <Pause aria-hidden="true" className="size-4" /> : <Play aria-hidden="true" className="size-4" />}
      </button>
    </div>
  )
}
/**
 * Animação já recortada (WebP com transparência): começa no quadro parado e troca para a animação
 * depois que a página carrega e o arquivo termina de baixar. Sem botão de pausa: quem pede menos
 * movimento no aparelho vê o Tuca parado (PNG).
 */
function PresenterAnimation({ media }: { media: Extract<PresenterMedia, { kind: 'animation' }> }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    const start = () => {
      const img = new Image()
      img.onload = () => { if (!cancelled) setReady(true) }
      img.src = media.src
    }
    const idle = (cb: () => void) => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(cb, { timeout: 2000 })
      else globalThis.setTimeout(cb, 300)
    }
    if (document.readyState === 'complete') idle(start)
    else window.addEventListener('load', () => idle(start), { once: true })
    return () => { cancelled = true }
  }, [media.src])
  return (
    <img
      src={ready ? media.src : media.poster}
      width={640}
      height={360}
      alt={ALT}
      data-testid="tuca-animation"
      draggable={false}
      decoding="async"
      className="block aspect-video h-auto w-full select-none"
    />
  )
}

function Media({ media }: { media: PresenterMedia }) {
  const common = { width: WIDTH, height: HEIGHT, className: MEDIA_CLASS, draggable: false }
  if (media.kind === 'animation') return <PresenterAnimation media={media} />
  if (media.kind === 'video') return <PresenterVideo media={media} />
  if (media.kind === 'gif') {
    return (
      <picture>
        <source srcSet={media.staticSrc} media="(prefers-reduced-motion: reduce)" />
        <img {...common} src={media.src} alt={ALT} decoding="async" {...HIGH_PRIORITY} />
      </picture>
    )
  }
  return (
    <img
      {...common}
      src={media.src}
      srcSet={media.srcSet}
      sizes="(min-width: 1024px) 15rem, (min-width: 768px) 12rem, 9rem"
      alt={ALT}
      decoding="async"
      {...HIGH_PRIORITY}
    />
  )
}

export interface TucaPresenterProps {
  media?: PresenterMedia
  className?: string
}

/** Um único Tuca de corpo inteiro com balão de apresentação acima dele. */
export function TucaPresenter({ media: requested = DEFAULT_PRESENTER, className = '' }: TucaPresenterProps) {
  const reduced = usePrefersReducedMotion()
  const media: PresenterMedia = reduced && (requested.kind === 'video' || requested.kind === 'animation') ? STATIC_PRESENTER : requested
  const baked = media.kind !== 'image' && media.hasBakedBubble === true
  // Vídeo/GIF não flutuam via CSS: a própria animação já tem movimento.
  const float = media.kind === 'image' ? 'tuca-float' : ''
  return (
    <figure className={`relative m-0 flex flex-col items-end ${className}`} data-testid="tuca-presenter">
      {baked ? (
        <figcaption className="sr-only">Oi! Eu sou o {BRAND.mascot}. Bem-vindo ao {BRAND.name}!</figcaption>
      ) : (
        <figcaption className="tuca-bubble relative z-10 mb-1 w-max max-w-full rounded-2xl rounded-br-md bg-brand px-3 py-2 text-left text-xs font-semibold leading-snug text-surface shadow-[var(--shadow-card)] sm:text-sm md:px-4 md:py-2.5">
          <span className="block">Oi! Eu sou o {BRAND.mascot}.</span>
          <span className="block">
            Bem-vindo ao <span className="text-orange">{BRAND.name}</span>!
          </span>
          {/* rabicho do balão apontando para o Tuca */}
          <span aria-hidden="true" className="absolute -bottom-1.5 right-6 size-3 rotate-45 rounded-[2px] bg-brand" />
        </figcaption>
      )}
      <div className="relative w-full">
        {/* halo laranja suave atrás do personagem (pequeno, sem gradiente extenso) */}
        {media.kind === 'image' && <span aria-hidden="true" className="absolute inset-x-[12%] bottom-[6%] top-[22%] rounded-full bg-orange/15 blur-2xl" />}
        <div className={`${float} relative`}>
          <Media media={media} />
        </div>
        {/* sombra no chão: mantém os pés "apoiados" */}
        <span aria-hidden="true" className={`block h-2 rounded-full bg-black/15 blur-[3px] ${media.kind === 'image' ? 'mx-auto -mt-1 w-1/2' : '-mt-3 ml-[60%] w-[25%]'}`} />
      </div>
    </figure>
  )
}