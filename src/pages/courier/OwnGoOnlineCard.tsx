import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Power } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../../components/feedback/toast-context.ts'
import { unlockSound } from '../../features/courier/offerAlert.ts'
import { VEHICLE_LABEL, ownCourierGoOnline, vehicles, type Vehicle } from '../../features/courier/repository.ts'

const field = 'min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink'

/**
 * Entregador próprio já logado: botão "Ficar online" direto na Área do entregador (sem página de cadastro).
 * Na primeira vez confirma celular e veículo e aceita os termos aqui mesmo; depois disso é só o botão.
 */
export function OwnGoOnlineCard({ pending }: { pending: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [v, setV] = useState<{ phone: string; vehicle: Vehicle; plate: string; cnh: string; terms: boolean }>({ phone: '', vehicle: 'moto', plate: '', cnh: '', terms: false })
  const motor = v.vehicle === 'moto' || v.vehicle === 'carro'
  const go = useMutation({
    mutationFn: () => ownCourierGoOnline({ phone: v.phone, vehicle: v.vehicle, plate: motor ? v.plate : undefined, cnh: motor ? v.cnh : undefined, acceptTerms: v.terms }),
    onSuccess: () => { toast.success('Você está online. As corridas de todas as lojas aparecem aqui.'); void qc.invalidateQueries({ queryKey: ['courier'] }) },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível ficar online.'),
  })
  if (pending) {
    return (
      <section className="rounded-card border border-line bg-surface p-4 text-base text-ink-muted md:p-6">
        Seu cadastro de entregador parceiro está em análise. Assim que for liberado, o botão <strong className="text-ink">Ficar online</strong> aparece aqui.
      </section>
    )
  }
  const ready = v.terms && v.phone.replace(/\D/g, '').length >= 10 && (!motor || (v.plate.trim() && v.cnh))
  return (
    <section aria-labelledby="online-proprio" className="flex flex-col gap-3 rounded-card border-2 border-orange bg-surface p-4 md:p-6">
      <h2 id="online-proprio" className="text-lg font-semibold text-ink">Você está offline</h2>
      <p className="text-base text-ink-muted">Fique online para receber, além das entregas da sua loja, as corridas de todas as lojas da sua cidade. Quem aceitar primeiro leva.</p>
      {!open ? (
        <button type="button" onClick={() => { unlockSound(); setOpen(true) }} className="pressable inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-orange px-6 text-lg font-semibold text-ink">
          <Power aria-hidden="true" className="size-5" />Ficar online e receber entregas
        </button>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (ready) go.mutate() }}>
          <p className="text-sm text-ink-muted">Só na primeira vez: confirme seus dados de entrega.</p>
          <div>
            <label htmlFor="op-tel" className="mb-1 block text-sm font-medium text-ink">Celular (WhatsApp)</label>
            <input id="op-tel" inputMode="tel" autoComplete="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} placeholder="(35) 99999-0000" className={field} />
          </div>
          <div>
            <label htmlFor="op-veiculo" className="mb-1 block text-sm font-medium text-ink">Veículo</label>
            <select id="op-veiculo" value={v.vehicle} onChange={(e) => setV({ ...v, vehicle: e.target.value as Vehicle })} className={field}>
              {vehicles.map((x) => <option key={x} value={x}>{VEHICLE_LABEL[x]}</option>)}
            </select>
          </div>
          {motor && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="op-placa" className="mb-1 block text-sm font-medium text-ink">Placa</label>
                <input id="op-placa" autoCapitalize="characters" value={v.plate} onChange={(e) => setV({ ...v, plate: e.target.value })} placeholder="ABC1D23" className={field} />
              </div>
              <div>
                <label htmlFor="op-cnh" className="mb-1 block text-sm font-medium text-ink">CNH</label>
                <select id="op-cnh" value={v.cnh} onChange={(e) => setV({ ...v, cnh: e.target.value })} className={field}>
                  <option value="">Escolha</option>
                  {['A', 'B', 'AB', 'AC', 'AD', 'AE'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          )}
          <label className="flex items-start gap-3 text-sm text-ink">
            <input type="checkbox" className="mt-0.5 size-5" checked={v.terms} onChange={(e) => setV({ ...v, terms: e.target.checked })} />
            <span>Li e aceito os <Link to="/termos" className="font-semibold text-brand underline">termos de parceria</Link> para as corridas da rede Tucaí.</span>
          </label>
          <button type="submit" disabled={!ready || go.isPending} className="pressable inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-orange px-6 text-lg font-semibold text-ink disabled:opacity-50">
            <Power aria-hidden="true" className="size-5" />{go.isPending ? 'Ficando online…' : 'Ficar online agora'}
          </button>
        </form>
      )}
    </section>
  )
}
