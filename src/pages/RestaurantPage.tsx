import { EmptyState } from '../components/feedback/EmptyState.tsx'

export function RestaurantPage() {
  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">Restaurante</h1>
      <EmptyState title="Em construção" description="Esta tela estará disponível em breve." />
    </section>
  )
}