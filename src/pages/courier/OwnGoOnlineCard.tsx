import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Power } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useToast } from '../../components/feedback/toast-context.ts'
import { unlockSound } from '../../features/courier/offerAlert.ts'
import { ownCourierGoOnline } from '../../features/courier/repository.ts'

/**
 * Entregador próprio já logado: UM clique em "Ficar online" (sem digitar nada). Os dados vêm da conta e a cidade
 * vem da loja (0056). Veículo e placa podem ser completados depois em Meus dados.
 */
export function OwnGoOnlineCard({ pending }: { pending: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const go = useMutation({
    mutationFn: ownCourierGoOnline,
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
  return (
    <section aria-labelledby="online-proprio" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id="online-proprio" className="text-lg font-semibold text-ink">Você está</h2>
        <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-base font-bold text-ink-muted">
          <span aria-hidden="true" className="size-3 rounded-full bg-line" />Offline
        </span>
      </div>
      <button type="button" disabled={go.isPending} onClick={() => { unlockSound(); go.mutate() }}
        className="pressable inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-orange px-6 text-lg font-semibold text-ink disabled:opacity-60">
        <Power aria-hidden="true" className="size-5" />{go.isPending ? 'Ficando online…' : 'Ficar online e receber entregas'}
      </button>
      <p className="text-xs text-ink-muted">
        Online, você recebe as corridas de todas as lojas da sua cidade, além das entregas da sua loja. Ao ficar online você aceita os{' '}
        <Link to="/termos" className="font-semibold text-brand underline">termos de parceria</Link>.
      </p>
    </section>
  )
}
