import { FlaskConical } from 'lucide-react'
import { useDataSource } from '../../lib/data-source'

/** Aviso único e discreto enquanto a prévia usa dados locais de demonstração (nada aqui é real). */
export function DemoBanner() {
  const { mode } = useDataSource()
  if (mode !== 'demo') return null
  return (
    <p role="note" className="flex items-center justify-center gap-1.5 bg-warm-soft px-3 py-1 text-center text-[0.6875rem] font-medium text-ink md:text-xs">
      <FlaskConical aria-hidden="true" className="size-3.5 shrink-0 text-warm" />
      <span>
        Prévia com dados fictícios
        <span className="hidden md:inline"> · lojas, avaliações e preços de exemplo; nenhum pedido ou pagamento é real</span>
      </span>
    </p>
  )
}