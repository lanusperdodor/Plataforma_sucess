import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { AUDIT_PAGE_SIZE, auditActions, auditPage, type AuditFilters } from '../../features/admin/repository.ts'
import { AdminHeader, formatDateTime, inputClass, Pager, primaryButton, secondaryButton } from './ui.tsx'

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
  'moderation.hide': 'Conteúdo ocultado',
  'moderation.dismiss': 'Denúncia sem violação',
  'moderation.suspend': 'Usuário suspenso no Conectuaí',
  'moderation.unsuspend': 'Suspensão encerrada',
  'moderation.appeal_reverse': 'Contestação aceita',
  'moderation.appeal_uphold': 'Contestação negada',
  'product.create': 'Produto cadastrado',
  'product.price': 'Preço alterado',
  'courier.submit': 'Cadastro de entregador',
  'courier.approve': 'Entregador aprovado',
  'courier.reject': 'Entregador recusado',
  'courier.suspend': 'Entregador suspenso',
  'courier.reactivate': 'Entregador reativado',
  'community.create': 'Comunidade criada',
  'accounts.name': 'Nome da conta alterado',
  'accounts.username': 'Usuário da conta alterado',
  'accounts.password': 'Senha temporária definida',
  'accounts.password_recovery_email': 'Recuperação de senha enviada',
  'accounts.block': 'Conta bloqueada',
  'accounts.unblock': 'Conta desbloqueada',
  'staff.invite': 'Convite para a equipe',
  'staff.invite_existing': 'Conta vinculada à equipe',
  'staff.invite_accept': 'Convite aceito',
  'staff.invite_revoke': 'Convite cancelado',
  'orders.cancel': 'Pedido cancelado pela Tucaí',
  'orders.redispatch': 'Entrega redistribuída',
  'delivery.accept': 'Entrega aceita',
  'delivery.decline': 'Oferta recusada',
  'delivery.release': 'Entrega liberada',
  'delivery.complete': 'Entrega concluída',
  'test_data.create': 'Dados de teste criados',
  'test_data.remove': 'Dados de teste removidos',
}

/** Logs de auditoria: 20 por página, paginação no banco, do mais recente para o mais antigo. Somente leitura. */
export function AdminAudit() {
  const empty: AuditFilters = { action: '', actor: '', from: '', to: '' }
  const [draft, setDraft] = useState<AuditFilters>(empty)
  const [filters, setFilters] = useState<AuditFilters>(empty)
  const [page, setPage] = useState(1)
  const actions = useQuery({ queryKey: ['admin', 'audit-actions'], queryFn: auditActions, staleTime: 300_000 })
  const q = useQuery({ queryKey: ['admin', 'audit', page, filters], queryFn: () => auditPage(page, filters), placeholderData: keepPreviousData })
  const rows = q.data ?? []
  const total = rows[0]?.total ?? 0
  const apply = (f: AuditFilters) => { setFilters(f); setPage(1) }
  return (
    <>
      <AdminHeader title="Auditoria" subtitle="Registro imutável das ações administrativas e cadastros." />
      <form
        className="mb-4 grid gap-2 rounded-card border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(e) => { e.preventDefault(); apply(draft) }}
      >
        <label className="text-sm font-medium text-ink">Ação
          <select value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} className={inputClass}>
            <option value="">Todas</option>
            {(actions.data ?? []).map((a) => <option key={a} value={a}>{ACTION_LABEL[a] ?? a}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-ink">Usuário (nome ou e-mail)
          <input value={draft.actor} onChange={(e) => setDraft({ ...draft, actor: e.target.value })} className={inputClass} />
        </label>
        <label className="text-sm font-medium text-ink">De
          <input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} className={inputClass} />
        </label>
        <label className="text-sm font-medium text-ink">Até
          <input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} className={inputClass} />
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className={primaryButton}>Filtrar</button>
          <button type="button" onClick={() => { setDraft(empty); apply(empty) }} className={secondaryButton}>Limpar</button>
        </div>
      </form>
      {q.isLoading ? (
        <p role="status" className="text-sm text-ink-muted">Carregando…</p>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Nenhum registro com estes filtros" />
      ) : (
        <>
          <ul aria-busy={q.isFetching} className={`divide-y divide-line overflow-hidden rounded-card border border-line bg-surface ${q.isFetching ? 'opacity-60' : ''}`}>
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-ink">{ACTION_LABEL[r.action] ?? r.action}</span>
                  <time className="text-xs text-ink-muted" dateTime={r.createdAt}>{formatDateTime(r.createdAt)}</time>
                </div>
                <span className="text-ink-muted">
                  {r.actorName ?? r.actorEmail ?? 'sistema'} · {r.entity}
                  {r.entityId ? ` · ${r.entityId}` : ''}
                </span>
                {Object.keys(r.details).length > 0 && (
                  <code className="block overflow-x-auto whitespace-pre rounded-lg bg-muted p-2 text-xs text-ink">{JSON.stringify(r.details)}</code>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3"><Pager page={page} pageSize={AUDIT_PAGE_SIZE} total={total} onPage={setPage} loading={q.isFetching} /></div>
        </>
      )}
    </>
  )
}
