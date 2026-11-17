import { useQuery } from '@tanstack/react-query'
import { BellRing, BellPlus, Check, MapPin, Smartphone, Truck } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Sheet } from '../../components/overlays/Sheet.tsx'
import { enableOfferSound, playOfferBeep } from '../../features/courier/offerAlert.ts'
import { DEFAULT_PREFS, readCourierPrefs, saveCourierPrefs, type CourierPrefs } from '../../features/courier/setupPrefs.ts'
import { enablePush, pushState } from '../../features/push/repository.ts'

function askLocation(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator) || typeof navigator.geolocation.getCurrentPosition !== 'function') return resolve(null)
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(null), { enableHighAccuracy: true, timeout: 12_000 })
  })
}

function Item({ icon: Icon, title, text, checked, onChange, locked = false }: {
  icon: typeof Truck; title: string; text: ReactNode; checked: boolean; onChange?: (v: boolean) => void; locked?: boolean
}) {
  return (
    <label className={`flex items-start gap-3 rounded-2xl border-2 p-3 ${checked ? 'border-orange bg-orange/5' : 'border-line'} ${locked ? '' : 'cursor-pointer'}`}>
      <span aria-hidden="true" className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-ink"><Icon className="size-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-ink">{title}</span>
        <span className="block text-sm text-ink-muted">{text}</span>
      </span>
      <input type="checkbox" className="mt-1 size-6 shrink-0 accent-[#FF5500]" checked={checked} disabled={locked} onChange={(e) => onChange?.(e.target.checked)} />
    </label>
  )
}

/**
 * Pop-up único do entregador: marca o que aceita (corridas, som, GPS, tela ligada, avisos com o app fechado e os termos)
 * e, com um toque em "Aceitar", tudo é ativado de uma vez. Em modo "ajustes" só salva as preferências.
 */
export function CourierSetupDialog({ open, onClose, mode, onAccept, busy = false }: {
  open: boolean
  onClose: () => void
  mode: 'online' | 'ajustes'
  /** chamado depois das permissões; recebe a localização (se permitida) para enviar ao servidor */
  onAccept: (r: { prefs: CourierPrefs; position: { lat: number; lng: number } | null }) => void
  busy?: boolean
}) {
  const [p, setP] = useState<CourierPrefs>(() => readCourierPrefs() ?? DEFAULT_PREFS)
  const [terms, setTerms] = useState(mode === 'ajustes')
  const [working, setWorking] = useState(false)
  useEffect(() => { if (open) { setP(readCourierPrefs() ?? DEFAULT_PREFS); setTerms(mode === 'ajustes') } }, [open, mode])
  const push = useQuery({ queryKey: ['push', 'estado'], queryFn: pushState, staleTime: 60_000, enabled: open })
  const pushAvailable = push.data === 'desligado' || push.data === 'ligado'
  const set = (k: keyof CourierPrefs) => (v: boolean) => setP((x) => ({ ...x, [k]: v }))

  // tudo dentro do toque (os navegadores só mostram os pedidos de permissão a partir de um toque)
  const accept = async () => {
    setWorking(true)
    try {
      if (p.sound) { const r = await enableOfferSound(); if (r === 'granted') playOfferBeep() }
      const position = p.gps ? await askLocation() : null
      if (p.push && pushAvailable && push.data === 'desligado') await enablePush().catch(() => undefined)
      saveCourierPrefs(p)
      onAccept({ prefs: p, position })
    } finally {
      setWorking(false)
    }
  }
  const pending = working || busy

  return (
    <Sheet open={open} onClose={onClose} title={mode === 'online' ? 'Antes de ficar online' : 'Avisos e permissões'}>
      <div className="flex flex-col gap-3 px-4 pb-4 pt-2">
        <p className="text-sm text-ink-muted">Marque o que você aceita. Com um toque, ativamos tudo de uma vez.</p>
        {mode === 'online' && (
          <Item icon={Truck} title="Receber corridas" text="Ficar Online e ver as corridas de todas as lojas da sua cidade. Quem aceitar primeiro leva." checked locked />
        )}
        <Item icon={BellRing} title="Som de corrida nova" text="O celular toca e vibra quando chega uma corrida (permite as notificações da Tucaí)." checked={p.sound} onChange={set('sound')} />
        <Item icon={MapPin} title="Usar minha localização (GPS)" text="Para traçar a rota até o restaurante e o cliente acompanhar a entrega. Só durante a entrega." checked={p.gps} onChange={set('gps')} />
        <Item icon={Smartphone} title="Manter a tela ligada" text="A tela não apaga enquanto você está Online (gasta um pouco mais de bateria)." checked={p.awake} onChange={set('awake')} />
        {pushAvailable && (
          <Item icon={BellPlus} title="Avisos com o app fechado" text="Receber o aviso de corrida mesmo com a Tucaí em segundo plano ou fechada." checked={p.push} onChange={set('push')} />
        )}
        {mode === 'online' && (
          <label className={`flex items-start gap-3 rounded-2xl border-2 p-3 ${terms ? 'border-orange bg-orange/5' : 'border-line'}`}>
            <span aria-hidden="true" className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-ink"><Check className="size-5" /></span>
            <span className="min-w-0 flex-1 text-base text-ink">Li e aceito os <Link to="/termos" className="font-semibold text-brand underline">termos de parceria</Link> da Tucaí.<span className="block text-sm text-ink-muted">Obrigatório para receber corridas.</span></span>
            <input type="checkbox" aria-label="Aceito os termos de parceria" className="mt-1 size-6 shrink-0 accent-[#FF5500]" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
          </label>
        )}
        <button type="button" disabled={!terms || pending} onClick={() => void accept()}
          className="pressable mt-1 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-orange px-6 text-lg font-bold text-ink disabled:opacity-50">
          <Check aria-hidden="true" className="size-5" />{pending ? 'Ativando…' : mode === 'online' ? 'Aceitar e ficar online' : 'Salvar'}
        </button>
        <button type="button" onClick={onClose} className="pressable inline-flex min-h-11 w-full items-center justify-center rounded-full text-base font-semibold text-ink-muted">Agora não</button>
      </div>
    </Sheet>
  )
}
