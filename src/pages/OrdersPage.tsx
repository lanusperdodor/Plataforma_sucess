import { Receipt } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/feedback/EmptyState.tsx'
import { LoginInvite } from '../components/feedback/LoginInvite.tsx'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { useAuth } from '../features/auth/AuthProvider.tsx'

/** Pedidos do cliente. O fluxo de pedidos (Sprint 4) ainda não existe no banco: nenhum pedido é simulado. */
export function OrdersPage() {
  const { session } = useAuth()
  return (
    <Page>
      <PageHeader icon={Receipt} title="Pedidos" subtitle="Acompanhe e repita seus pedidos." />
      {!session ? (
        <LoginInvite icon={Receipt} title="Seus pedidos ficam aqui" description="Entre para acompanhar entregas." />
      ) : (
        <EmptyState
          icon={Receipt}
          title="Você ainda não tem pedidos"
          description="Os pedidos online estão em implementação. Quando estiverem liberados, seus pedidos aparecerão aqui."
          action={<Link to="/restaurantes" className="pressable inline-flex min-h-11 items-center rounded-full bg-orange px-5 text-sm font-semibold text-ink">Ver restaurantes</Link>}
        />
      )}
    </Page>
  )
}
