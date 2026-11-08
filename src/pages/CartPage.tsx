import { ShoppingBag } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/feedback/EmptyState.tsx'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'

export function CartPage() {
  return (
    <Page>
      <PageHeader icon={ShoppingBag} title="Sacola" subtitle="Itens de um restaurante por vez, com total antes de confirmar." />
      <EmptyState
        icon={ShoppingBag}
        title="Sua sacola está vazia"
        description="Escolha um restaurante e adicione itens. Pedidos desta prévia são apenas de teste, sem cobrança."
        action={<Link to="/restaurantes" className="pressable inline-flex min-h-11 items-center rounded-full bg-orange px-5 text-sm font-semibold text-ink">Ver restaurantes</Link>}
      />
    </Page>
  )
}