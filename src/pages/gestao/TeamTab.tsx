import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { sendInviteLink } from '../../features/account/repository.ts'
import {
  inviteMember, listMemberExtras, listTeam, MEMBER_ROLE_LABEL, removeMember, setMemberPermission, setMemberRole, type MemberRole,
} from '../../features/gestao/repository.ts'
import { useGestao } from './context.ts'
import { box, field, msg, primary, SectionTitle } from './ui.tsx'

type StaffRole = Exclude<MemberRole, 'owner'>
const ROLES: StaffRole[] = ['manager', 'attendant', 'kitchen', 'courier_own']
const EXTRAS = [
  { code: 'tabs.manage', label: 'Comandas e mesas' },
  { code: 'cash.manage', label: 'Operar caixa' },
  { code: 'reports.view', label: 'Relatórios e saídas de caixa' },
] as const
const ROLE_HINT: Record<StaffRole, string> = {
  manager: 'Tudo, exceto equipe e configurações sensíveis.',
  attendant: 'Pedidos e comandas.',
  kitchen: 'Fila da cozinha e status dos pedidos.',
  courier_own: 'Entregas próprias da loja.',
}

/** Equipe: convites por e-mail, cargo e permissões extras. Quem decide é o banco (staff.manage). */
export function TeamTab() {
  const { business: b, premium } = useGestao()
  const qc = useQueryClient()
  const toast = useToast()
  const team = useQuery({ queryKey: ['gestao', 'team', b.id], queryFn: () => listTeam(b.id) })
  const extras = useQuery({ queryKey: ['gestao', 'extras-all', b.id], queryFn: () => listMemberExtras(b.id) })
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<StaffRole>('attendant')
  const refresh = () => void qc.invalidateQueries({ queryKey: ['gestao'] })
  const invite = useMutation({
    mutationFn: async () => {
      const r = await inviteMember(b.id, email, role)
      if (r === 'convidado') await sendInviteLink(email.trim()).catch(() => undefined)
      return r
    },
    onSuccess: (r) => {
      toast.success(r === 'vinculado' ? 'Pessoa adicionada à equipe.' : 'Convite enviado. O acesso é liberado quando a pessoa criar a conta com este e-mail.')
      setEmail('')
      refresh()
    },
    onError: (e) => toast.error(msg(e)),
  })
  const change = useMutation({
    mutationFn: async (a: { kind: 'role'; user: string; role: StaffRole } | { kind: 'extra'; user: string; perm: (typeof EXTRAS)[number]['code']; on: boolean } | { kind: 'remove'; user: string | null; invite: string | null }) => {
      if (a.kind === 'role') return setMemberRole(b.id, a.user, a.role)
      if (a.kind === 'extra') return setMemberPermission(b.id, a.user, a.perm, a.on)
      if (!window.confirm('Remover esta pessoa da equipe?')) return
      return removeMember(b.id, a.user, a.invite)
    },
    onSuccess: () => refresh(),
    onError: (e) => toast.error(msg(e)),
  })
  const has = (user: string, perm: string) => (extras.data ?? []).some((x) => x.userId === user && x.permission === perm)
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle title="Equipe" subtitle="Cada pessoa entra com a própria conta. Ninguém vê a senha de ninguém." />
      <form onSubmit={(e) => { e.preventDefault(); invite.mutate() }} className={`${box} grid grid-cols-1 gap-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end`}>
        <label className="text-sm font-medium text-ink">E-mail
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" className={`${field} mt-1`} />
        </label>
        <label className="text-sm font-medium text-ink">Cargo
          <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} className={`${field} mt-1`}>
            {ROLES.map((r) => <option key={r} value={r}>{MEMBER_ROLE_LABEL[r]}</option>)}
          </select>
        </label>
        <button type="submit" disabled={invite.isPending} className={primary}><UserPlus aria-hidden="true" className="size-4" />Convidar</button>
        <p className="text-xs text-ink-muted sm:col-span-3">{MEMBER_ROLE_LABEL[role]}: {ROLE_HINT[role]}</p>
      </form>
      {team.isError ? <ErrorState error={team.error} onRetry={() => void team.refetch()} /> : (team.data ?? []).length === 0 ? (
        <EmptyState icon={Users} title={team.isLoading ? 'Carregando…' : 'Só você por enquanto'} />
      ) : (
        <ul className="flex flex-col gap-2">
          {(team.data ?? []).map((m) => (
            <li key={m.userId ?? m.inviteId} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 md:flex-row md:items-center">
              <div className="min-w-0 md:flex-1">
                <p className="truncate font-semibold text-ink">{m.name ?? m.email ?? 'Convidado'}</p>
                <p className="truncate text-sm text-ink-muted">{m.email}{m.pending ? ' · convite pendente' : ''}</p>
              </div>
              {m.role === 'owner' ? (
                <span className="w-fit rounded-full bg-muted px-3 py-1 text-xs font-semibold text-ink">{MEMBER_ROLE_LABEL.owner}</span>
              ) : (
                <div className="flex flex-col gap-2 md:items-end">
                  <div className="flex flex-wrap items-center gap-2">
                    {m.userId && !m.pending ? (
                      <select
                        aria-label={`Cargo de ${m.name ?? m.email}`}
                        value={m.role}
                        onChange={(e) => change.mutate({ kind: 'role', user: m.userId!, role: e.target.value as StaffRole })}
                        className="min-h-9 rounded-full border border-line bg-surface px-3 text-sm text-ink"
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{MEMBER_ROLE_LABEL[r]}</option>)}
                      </select>
                    ) : (
                      <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-ink">{MEMBER_ROLE_LABEL[m.role]}</span>
                    )}
                    <button type="button" onClick={() => change.mutate({ kind: 'remove', user: m.pending ? null : m.userId, invite: m.inviteId })} className="pressable min-h-9 rounded-full px-3 text-sm font-semibold text-danger hover:bg-muted">Remover</button>
                  </div>
                  {m.userId && !m.pending && premium && (
                    <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
                      <legend className="sr-only">Permissões extras</legend>
                      {EXTRAS.map((x) => (
                        <label key={x.code} className="inline-flex min-h-9 items-center gap-1.5 text-sm text-ink">
                          <input type="checkbox" checked={has(m.userId!, x.code)} onChange={(e) => change.mutate({ kind: 'extra', user: m.userId!, perm: x.code, on: e.target.checked })} className="size-4" />
                          {x.label}
                        </label>
                      ))}
                    </fieldset>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
