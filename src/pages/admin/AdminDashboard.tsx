import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { Skeleton } from '../../components/feedback/Skeleton.tsx'
import { getDashboard } from '../../features/admin/repository.ts'
import { AdminHeader, formatDateTime } from './ui.tsx'

function Stat({ label, value, to }: { label: string; value: number; to?: string }) {
  const body = (
    <>
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-ink">{value.toLocaleString('pt-BR')}</p>
    </>
  )
  return to ? (
    <Link to={to} className="hover-lift pressable block rounded-card border border-line bg-surface p-4">{body}</Link>
  ) : (
    <div className="rounded-card border border-line bg-surface p-4">{body}</div>
  )
}

/** Painel geral: somente contagens reais vindas do banco. */
export function AdminDashboard() {
  const q = useQuery({ queryKey: ['admin', 'dashboard'], queryFn: getDashboard, staleTime: 15_000 })
  return (
    <>
      <AdminHeader title="Painel geral" subtitle={q.data ? `Atualizado em ${formatDateTime(q.data.generatedAt)}` : 'Visão da operação'} />
      {q.isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data ? (
        <div className="flex flex-col gap-6">
          <section aria-labelledby="dash-est">
            <h2 id="dash-est" className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-muted">Estabelecimentos</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Aguardando análise" value={q.data.businesses.pending} to="/admin/estabelecimentos?status=pending" />
              <Stat label="Ativos" value={q.data.businesses.active} to="/admin/estabelecimentos?status=active" />
              <Stat label="Suspensos" value={q.data.businesses.suspended} to="/admin/estabelecimentos?status=suspended" />
              <Stat label="Recusados" value={q.data.businesses.rejected} to="/admin/estabelecimentos?status=rejected" />
            </div>
          </section>
          <section aria-labelledby="dash-plat">
            <h2 id="dash-plat" className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-muted">Plataforma</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Usuários cadastrados" value={q.data.usersTotal} />
              <Stat label="Cidades ativas" value={q.data.citiesActive} to="/admin/cidades" />
              <Stat label="Equipe administrativa" value={q.data.staffTotal} />
              <Stat label="Ações auditadas (24 h)" value={q.data.auditLast24h} />
            </div>
          </section>
          <p className="text-xs text-ink-muted">
            Pedidos, entregas, financeiro e moderação entram neste painel conforme cada módulo for liberado.
          </p>
        </div>
      ) : null}
    </>
  )
}
