import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff, Smartphone, Volume2 } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '../../components/feedback/toast-context.ts'
import { playOfferBeep, unlockSound, useWakeLock, vibrateOffer } from '../../features/courier/offerAlert.ts'
import { disablePush, enablePush, pushState, type PushState } from '../../features/push/repository.ts'

const btn = 'pressable inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-5 text-base font-semibold disabled:opacity-50'

const TEXT: Record<PushState, string> = {
  ligado: 'Avisos ligados neste celular: quando chegar uma corrida, o celular avisa mesmo com a Tucaí em segundo plano ou fechada.',
  desligado: 'Ative para o celular avisar quando chegar uma corrida, mesmo com a Tucaí em segundo plano ou fechada.',
  bloqueado: 'As notificações da Tucaí estão bloqueadas. Libere em Configurações do navegador → Notificações → Tucaí e volte aqui.',
  nao_configurado: 'Com o app aberto, a Tucaí já toca um bip e vibra a cada corrida nova. Os avisos com o app fechado serão liberados em breve.',
  iphone_instalar: 'No iPhone, para receber avisos com o app fechado, toque em Compartilhar → "Adicionar à Tela de Início" e abra a Tucaí pelo ícone.',
  sem_suporte: 'Este navegador não oferece avisos com o app fechado. Use o Chrome no Android. Com o app aberto, o bip e a vibração funcionam.',
}

/** Bip de teste, tela ligada e avisos com o app fechado (Web Push). */
export function OfferAlertsCard({ online }: { online: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [awake, setAwake] = useState(false)
  const wakeSupported = useWakeLock(online && awake)
  const st = useQuery({ queryKey: ['push', 'estado'], queryFn: pushState, staleTime: 60_000 })
  const on = useMutation({
    mutationFn: enablePush,
    onSuccess: () => { toast.success('Avisos de corrida ligados neste celular.'); void qc.invalidateQueries({ queryKey: ['push'] }) },
    onError: (e) => { toast.error(e instanceof Error ? e.message : 'Não foi possível ligar os avisos.'); void qc.invalidateQueries({ queryKey: ['push'] }) },
  })
  const off = useMutation({
    mutationFn: disablePush,
    onSuccess: () => { toast.success('Avisos desligados neste celular.'); void qc.invalidateQueries({ queryKey: ['push'] }) },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível desligar os avisos.'),
  })
  const s = st.data
  return (
    <section aria-labelledby="avisos" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 md:p-6">
      <h2 id="avisos" className="flex items-center gap-2 text-lg font-semibold text-ink"><Bell aria-hidden="true" className="size-5" />Aviso de corrida nova</h2>
      <p className="text-base text-ink-muted">{s ? TEXT[s] : 'Verificando este celular…'}</p>
      <div className="flex flex-wrap gap-2">
        {s === 'desligado' && (
          <button type="button" disabled={on.isPending} onClick={() => { unlockSound(); on.mutate() }} className={`${btn} bg-orange text-ink`}>
            <Bell aria-hidden="true" className="size-5" />{on.isPending ? 'Ligando…' : 'Ligar avisos de corrida'}
          </button>
        )}
        {s === 'ligado' && (
          <button type="button" disabled={off.isPending} onClick={() => off.mutate()} className={`${btn} border-2 border-line text-ink`}>
            <BellOff aria-hidden="true" className="size-5" />Desligar avisos
          </button>
        )}
        <button type="button" onClick={() => { unlockSound(); playOfferBeep(); vibrateOffer() }} className={`${btn} border-2 border-line text-ink`}>
          <Volume2 aria-hidden="true" className="size-5" />Testar som
        </button>
      </div>
      {wakeSupported && (
        <label className="flex min-h-11 items-center gap-3 text-base text-ink">
          <input type="checkbox" className="size-5" checked={awake} onChange={(e) => setAwake(e.target.checked)} />
          <Smartphone aria-hidden="true" className="size-5 text-ink-muted" />Manter a tela ligada enquanto estou online
        </label>
      )}
      <p className="text-xs text-ink-muted">Deixe o volume do celular ligado. O som toca a cada corrida nova enquanto a Tucaí estiver aberta; com ela em segundo plano ou fechada, quem avisa é a notificação do celular.</p>
    </section>
  )
}
