import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigation, Power, Truck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { Page, PageHeader } from '../../components/nav/PageHeader.tsx'
import { useAuth } from '../../features/auth/AuthProvider.tsx'
import { VEHICLE_LABEL, getMyCourier, setOnline } from '../../features/courier/repository.ts'

/** Área do entregador aprovado: disponibilidade real (persistida). Ofertas chegam com o módulo de pedidos. */
export function CourierArea() {
  const { session } = useAuth()
  const userId = session?.user.id
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['courier', 'me', userId ?? ''], queryFn: () => getMyCourier(userId!), enabled: !!userId })
  const toggle = useMutation({
    mutationFn: (on: boolean) => setOnline(on),
    onSuccess: (on) => {
      toast.success(on ? 'Você está disponível.' : 'Você está indisponível.')
      void qc.invalidateQueries({ queryKey: ['courier'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível alterar.'),
  })
  if (q.isLoading) return <Page><p role="status" className="text-sm text-ink-muted">Carregando…</p></Page>
  if (q.isError) return <Page><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Page>
  const c = q.data
  if (!c || c.status !== 'approved') {
    return (
      <Page>
        <EmptyState icon={Truck} title="Área exclusiva de entregadores aprovados" description="Faça ou acompanhe seu cadastro na página de entregadores." action={<Link to="/entregadores" className="pressable inline-flex min-h-11 items-center rounded-full bg-orange px-5 text-sm font-semibold text-ink">Ir para o cadastro</Link>} />
      </Page>
    )
  }
  return (
    <Page>
      <PageHeader icon={Truck} title="Área do entregador" subtitle={`${c.fullName} · ${VEHICLE_LABEL[c.vehicle]}${c.plate ? ` · ${c.plate}` : ''}`} />
      <section aria-labelledby="disp" className="flex flex-col items-start gap-3 rounded-card border border-line bg-surface p-4 md:p-6">
        <h2 id="disp" className="text-lg font-semibold text-ink">Disponibilidade</h2>
        <p className={`inline-flex items-center gap-2 text-sm font-semibold ${c.isOnline ? 'text-success' : 'text-ink-muted'}`}>
          <span aria-hidden="true" className={`size-2.5 rounded-full ${c.isOnline ? 'bg-success' : 'bg-line'}`} />
          {c.isOnline ? 'Disponível para entregas' : 'Indisponível'}
        </p>
        <button type="button" disabled={toggle.isPending} onClick={() => toggle.mutate(!c.isOnline)} className={`pressable inline-flex min-h-12 items-center gap-2 rounded-full px-6 text-base font-semibold ${c.isOnline ? 'border border-line text-ink' : 'bg-orange text-ink'}`}>
          <Power aria-hidden="true" className="size-5" />{c.isOnline ? 'Ficar indisponível' : 'Ficar disponível'}
        </button>
      </section>
      <EmptyState icon={Navigation} title="Nenhuma oferta de entrega" description="As ofertas, com origem, destino e valor previsto, aparecem aqui quando os pedidos online forem liberados." />
    </Page>
  )
}
