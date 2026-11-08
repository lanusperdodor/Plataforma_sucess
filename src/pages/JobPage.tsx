import { EmptyState } from '../components/feedback/EmptyState.tsx'

export function JobPage() {
  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">Vaga</h1>
      <EmptyState title="Em construção" description="Esta tela estará disponível em breve." />
    </section>
  )
}