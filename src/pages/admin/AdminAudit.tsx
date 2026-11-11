import { useInfiniteQuery } from '@tanstack/react-query'
import { ClipboardList } from 'lucide-react'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { listAudit, type AuditEntry } from '../../features/admin/repository.ts'
import { AdminHeader, formatDateTime, secondaryButton } from './ui.tsx'

const PAGE = 50

const ACTION_LABEL: Record<string, string> = {
  grant_role: 'Papel concedido',
  revoke_role: 'Papel revogado',
  'business.submit': 'Solicitação de cadastro',
  'business.approve': 'Estabelecimento aprovado',
  'business.reject': 'Estabelecimento recusado',
  'business.suspend': 'Estabelecimento suspenso',
  'business.reactivate': 'Estabelecimento reativado',
  'city.create': 'Cidade cadastrada',
  'city.update': 'Cidade alterada',
  'staff_permission.grant': 'Permissão concedida',
  'staff_permission.revoke': 'Permissão revogada',
  'setting.update': 'Configuração alterada',
  'privacy.request': 'Solicitação de privacidade',
  'privacy.in_progress': 'Privacidade: em atendimento',
  'privacy.completed': 'Privacidade: concluída',
  'privacy.rejected': 'Privacidade: não atendida',
  bootstrap_master: 'Primeiro Master criado',
}

/** Logs de auditoria (somente leitura; o banco impede alteração e exclusão). */
export function AdminAudit() {
  const q = useInfiniteQuery<AuditEntry[], Error, { pages: AuditEntry[][] }, readonly unknown[], number | null>({
    queryKey: ['admin', 'audit'],
    queryFn: ({ pageParam }) => listAudit(pageParam, PAGE),
    initialPageParam: null,
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1]!.id : undefined),
  })
  const rows = (q.data?.pages ?? []).flat()
  return (
    <>
      <AdminHeader title="Auditoria" subtitle="Registro imutável das ações administrativas e cadastros." />
      {q.isLoading ? (
        <p role="status" className="text-sm text-ink-muted">Carregando…</p>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Nenhum registro ainda" />
      ) : (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-ink">{ACTION_LABEL[r.action] ?? r.action}</span>
                  <time className="text-xs text-ink-muted" dateTime={r.createdAt}>{formatDateTime(r.createdAt)}</time>
                </div>
                <span className="text-ink-muted">
                  {r.actorEmail ?? 'sistema'} · {r.entity}
                  {r.entityId ? ` · ${r.entityId}` : ''}
                </span>
                {Object.keys(r.details).length > 0 && (
                  <code className="block overflow-x-auto whitespace-pre rounded-lg bg-muted p-2 text-xs text-ink">{JSON.stringify(r.details)}</code>
                )}
              </li>
            ))}
          </ul>
          {q.hasNextPage && (
            <button type="button" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage} className={`${secondaryButton} mt-3`}>
              {q.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
            </button>
          )}
        </>
      )}
    </>
  )
}
