import { useQuery } from '@tanstack/react-query'
import { Receipt } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/feedback/EmptyState.tsx'
import { ErrorState } from '../components/feedback/ErrorState.tsx'
import { LoginInvite } from '../components/feedback/LoginInvite.tsx'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import { STATUS_LABEL, isFinal, listMyOrders } from '../features/orders/repository.ts'
import { formatBRL } from '../lib/money.ts'

export const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })

/** Pedidos do cliente, direto do banco (RLS: só os próprios). */
export function OrdersPage() {
  const { session } = useAuth()
  const me = session?.user.id
  const q = useQuery({ queryKey: ['orders', 'mine', me ?? ''], queryFn: () => listMyOrders(me!), enabled: !!me, refetchInterval: 30_000 })
  return (
    <Page>
      <PageHeader icon={Receipt} title="Pedidos" subtitle="Acompanhe seus pedidos." />
      {!session ? (
        <LoginInvite icon={Receipt} title="Seus pedidos ficam aqui" description="Entre para acompanhar entregas." />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={q.isLoading ? 'Carregando…' : 'Você ainda não tem pedidos'}
          description={q.isLoading ? undefined : 'Escolha um restaurante ou loja e faça seu primeiro pedido.'}
          action={q.isLoading ? undefined : <Link to="/restaurantes" className="pressable inline-flex min-h-11 items-center rounded-full bg-orange px-5 text-sm font-semibold text-ink">Ver restaurantes</Link>}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {(q.data ?? []).map((o) => (
            <li key={o.id}>
              <Link to={`/pedidos/${o.id}`} className="hover-lift pressable flex flex-col gap-1 rounded-card border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{o.business?.name ?? 'Estabelecimento'} · #{o.code}</span>
                  <span className="text-sm text-ink-muted">{dateTime.format(new Date(o.createdAt))} · {formatBRL(o.totalCents)}</span>
                </span>
                <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${isFinal(o.status) ? 'bg-muted text-ink-muted' : 'bg-orange text-ink'}`}>{STATUS_LABEL[o.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}
