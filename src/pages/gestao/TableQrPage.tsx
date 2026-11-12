import { useQuery } from '@tanstack/react-query'
import { UtensilsCrossed } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { businessHref } from '../../components/cards/BusinessCard.tsx'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { Page } from '../../components/nav/PageHeader.tsx'
import { tableByQr } from '../../features/gestao/repository.ts'

/** Página aberta pelo QR impresso na mesa: identifica a mesa e leva ao cardápio público. Nada administrativo. */
export function TableQrPage() {
  const { token = '' } = useParams()
  const valid = /^[0-9a-f-]{36}$/i.test(token)
  const q = useQuery({ queryKey: ['mesa', token], queryFn: () => tableByQr(token), enabled: valid })
  if (q.isError) return <Page><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Page>
  if (valid && q.isLoading) return <Page><p role="status" className="text-sm text-ink-muted">Carregando…</p></Page>
  const t = q.data
  if (!valid || !t) return <Page><EmptyState icon={UtensilsCrossed} title="Mesa não encontrada" description="Este QR não está mais ativo. Peça ajuda à equipe do estabelecimento." /></Page>
  return (
    <Page>
      <section className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface p-6 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-muted text-ink"><UtensilsCrossed aria-hidden="true" className="size-6" /></span>
        <h1 className="text-2xl font-bold text-ink">{t.businessName}</h1>
        <p className="text-base text-ink">Você está na <strong>{t.tableName}</strong>.</p>
        <p className="max-w-prose text-sm text-ink-muted">Veja o cardápio e chame a equipe para fazer o pedido. Os pedidos da mesa são lançados pelo atendimento.</p>
        <Link to={businessHref({ businessType: t.businessType as 'restaurante' | 'loja' | 'servico', slug: t.businessSlug })} className="pressable inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-sm font-semibold text-surface">Ver cardápio</Link>
      </section>
    </Page>
  )
}
