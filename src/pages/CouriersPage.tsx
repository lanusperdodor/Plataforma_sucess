import { Bike, FileCheck2, ShieldCheck, Wallet } from 'lucide-react'
import { StateShell } from '../components/feedback/StateShell.tsx'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'

const STEPS = [
  { icon: FileCheck2, title: 'Cadastro e documentos', text: 'Dados pessoais, documento com foto e dados do veículo.' },
  { icon: ShieldCheck, title: 'Análise pela Tucaí', text: 'A equipe confere os documentos antes de liberar o acesso.' },
  { icon: Wallet, title: 'Ofertas com valor antes do aceite', text: 'Você vê origem, destino e valor previsto e decide se aceita.' },
]

/**
 * Entrada da área de entregadores parceiros (independentes, sem vínculo empregatício presumido).
 * O cadastro, a análise e o painel do entregador são implementados na Sprint 5; até lá
 * a página informa claramente que o cadastro ainda não está aberto.
 */
export function CouriersPage() {
  return (
    <Page>
      <PageHeader icon={Bike} title="Entregadores parceiros" subtitle="Faça entregas na sua cidade com a Tucaí, no seu horário." />
      <StateShell
        icon={Bike}
        role="status"
        title="Cadastro ainda não aberto"
        description="O módulo de entregadores está em implementação. Quando o cadastro for liberado, ele estará disponível nesta página."
      />
      <section aria-labelledby="entregadores-como" className="flex flex-col gap-3">
        <h2 id="entregadores-como" className="text-lg font-semibold text-ink">Como vai funcionar</h2>
        <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
              <Icon aria-hidden="true" className="size-6 text-brand" />
              <p className="text-sm font-semibold text-ink">{title}</p>
              <p className="text-sm text-ink-muted">{text}</p>
            </li>
          ))}
        </ol>
        <p className="text-xs text-ink-muted">
          Entregadores são parceiros independentes. As condições de parceria serão publicadas após validação jurídica.
        </p>
      </section>
    </Page>
  )
}
