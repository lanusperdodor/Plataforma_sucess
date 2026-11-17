import { useEffect, useRef } from 'react'

/**
 * Alerta de corrida nova no celular: bip (gerado na hora, sem arquivo de áudio), vibração e, com a tela em segundo
 * plano, notificação do sistema. O navegador só libera o som depois de um toque: unlockSound() é chamado no
 * botão "Ficar online" (e em qualquer toque na Área do entregador).
 */

type Ctx = AudioContext
let ctx: Ctx | null = null

function audio(): Ctx | null {
  if (typeof window === 'undefined') return null
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!C) return null
  ctx ??= new C()
  return ctx
}

export function unlockSound(): void {
  const a = audio()
  if (a && a.state === 'suspended') void a.resume().catch(() => undefined)
}

/** Três bipes curtos e altos (fácil de ouvir na rua). */
export function playOfferBeep(): boolean {
  const a = audio()
  if (!a) return false
  if (a.state === 'suspended') void a.resume().catch(() => undefined)
  const t0 = a.currentTime + 0.02
  for (let i = 0; i < 3; i++) {
    const at = t0 + i * 0.32
    const osc = a.createOscillator()
    const gain = a.createGain()
    osc.type = 'square'
    osc.frequency.setValueAtTime(i === 2 ? 1320 : 988, at)
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(0.35, at + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22)
    osc.connect(gain).connect(a.destination)
    osc.start(at)
    osc.stop(at + 0.24)
  }
  return true
}

export function vibrateOffer(): void {
  try { navigator.vibrate?.([400, 150, 400, 150, 400]) } catch { /* sem vibração */ }
}

async function systemNotice(count: number): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const body = count > 1 ? `${count} corridas novas. Toque para ver e aceitar.` : 'Toque para ver e aceitar. Quem aceitar primeiro leva.'
  const opts = { body, icon: '/brand/icone-1024.png', tag: 'tucai-corrida', renotify: true, data: { url: '/entregador' } } as NotificationOptions
  try {
    const reg = await navigator.serviceWorker?.getRegistration('/')
    if (reg) await reg.showNotification('Nova corrida disponível', opts)
    else new Notification('Nova corrida disponível', opts)
  } catch { /* sem notificação */ }
}

export function alertNewOffers(count: number): void {
  playOfferBeep()
  vibrateOffer()
  if (typeof document !== 'undefined' && document.hidden) void systemNotice(count)
}

/**
 * Chama onNew com as corridas que apareceram desde a última lista. A primeira lista também avisa quando já há
 * corridas (ex.: o entregador acabou de ficar Online ou abriu o app pela notificação).
 */
export function useNewOffers(ids: string[] | undefined, enabled: boolean, onNew: (fresh: string[]) => void): void {
  const seen = useRef<Set<string> | null>(null)
  const cb = useRef(onNew)
  cb.current = onNew
  const key = (ids ?? []).join(',')
  useEffect(() => {
    if (!enabled) { seen.current = null; return }
    if (!ids) return
    if (seen.current === null) { seen.current = new Set(ids); if (ids.length) cb.current(ids); return }
    const fresh = ids.filter((id) => !seen.current!.has(id))
    seen.current = new Set(ids)
    if (fresh.length) cb.current(fresh)
    // a lista é comparada pelo conteúdo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])
}

/** Mantém a tela ligada enquanto o entregador está Online e com a opção ativa (quando o aparelho permite). */
export function useWakeLock(on: boolean): boolean {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator
  useEffect(() => {
    if (!on || !supported) return
    let lock: { release(): Promise<void> } | null = null
    let alive = true
    const take = async () => {
      try {
        const l = await (navigator as unknown as { wakeLock: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock.request('screen')
        if (alive) lock = l; else void l.release()
      } catch { /* bateria fraca ou sem permissão */ }
    }
    const onVis = () => { if (document.visibilityState === 'visible') void take() }
    void take()
    document.addEventListener('visibilitychange', onVis)
    return () => { alive = false; document.removeEventListener('visibilitychange', onVis); void lock?.release().catch(() => undefined) }
  }, [on, supported])
  return supported
}
