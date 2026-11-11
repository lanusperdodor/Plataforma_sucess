import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus, Users } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { useAuth } from '../../features/auth/AuthProvider.tsx'
import {
  PLATFORM_PERMISSION_CODES,
  findUserByEmail,
  grantOperatorRole,
  listStaff,
  revokeOperatorRole,
  setStaffPermission,
  type StaffMember,
} from '../../features/admin/repository.ts'
import { AdminHeader, dangerButton, errorMessage, inputClass, Panel, primaryButton } from './ui.tsx'

export const PERMISSION_LABEL: Record<(typeof PLATFORM_PERMISSION_CODES)[number], string> = {
  'admin.dashboard': 'Painel geral',
  'users.view': 'Consultar usuários',
  'businesses.review': 'Analisar estabelecimentos',
  'cities.manage': 'Gerenciar cidades',
  'audit.view': 'Ver auditoria',
  'privacy.manage': 'Privacidade (LGPD)',
  'couriers.review': 'Analisar entregadores',
  'orders.view': 'Consultar pedidos',
  'orders.manage': 'Tratar ocorrências de pedidos',
  'finance.view': 'Consultar financeiro',
  'moderation.manage': 'Moderação do Conectuaí',
  'support.manage': 'Chamados',
  'campaigns.manage': 'Campanhas',
  'jobs.manage': 'Vagas',
}

function MemberCard({ member, self }: { member: StaffMember; self: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const isMaster = member.roles.includes('platform_master')
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin'] })
  const toggle = useMutation({
    mutationFn: ({ code, granted }: { code: string; granted: boolean }) => setStaffPermission(member.userId, code, granted),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: () => revokeOperatorRole(member.userId),
    onSuccess: () => {
      toast.success('Operador removido da equipe.')
      refresh()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold text-ink">{member.fullName || member.email}</h2>
          <p className="truncate text-sm text-ink-muted">{loginLabel(member.email)}</p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-ink">{isMaster ? 'Master' : 'Operador'}</span>
      </div>
      {isMaster ? (
        <p className="text-sm text-ink-muted">O Master tem todas as permissões. Papéis de Master só são concedidos diretamente no banco, com registro.</p>
      ) : (
        <>
          <fieldset disabled={self || toggle.isPending}>
            <legend className="mb-2 text-sm font-medium text-ink">Permissões</legend>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {PLATFORM_PERMISSION_CODES.map((code) => (
                <label key={code} className="flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm text-ink hover:bg-muted">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={member.permissions.includes(code)}
                    onChange={(e) => toggle.mutate({ code, granted: e.target.checked })}
                  />
                  {PERMISSION_LABEL[code]}
                </label>
              ))}
            </div>
          </fieldset>
          {!self && (
            <button type="button" disabled={remove.isPending} onClick={() => remove.mutate()} className={`${dangerButton} w-fit`}>
              Remover da equipe
            </button>
          )}
        </>
      )}
    </Panel>
  )
}

function AddOperator() {
  const qc = useQueryClient()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string>()
  const add = useMutation({
    mutationFn: async (value: string) => {
      const user = await findUserByEmail(value)
      if (!user) throw new Error('Nenhuma conta com este e-mail. A pessoa precisa se cadastrar na Tucaí primeiro.')
      await grantOperatorRole(user.userId)
      return user
    },
    onSuccess: (u) => {
      toast.success(`${u.email} agora é operador, sem permissões. Libere as necessárias abaixo.`)
      setEmail('')
      void qc.invalidateQueries({ queryKey: ['admin'] })
    },
    onError: (e) => setError(errorMessage(e)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(undefined)
    add.mutate(email.trim())
  }
  return (
    <Panel className="mb-4">
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="staff-email" className="mb-1 block text-sm font-medium text-ink">Adicionar operador por e-mail</label>
          <input id="staff-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </div>
        <button type="submit" disabled={add.isPending} className={primaryButton}>
          <UserPlus aria-hidden="true" className="size-4" />
          Adicionar
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <p className="mt-2 text-xs text-ink-muted">Novos operadores começam sem nenhuma permissão. Toda alteração fica registrada na auditoria.</p>
    </Panel>
  )
}

/** Gestão da equipe administrativa (somente Master). Permissões granulares e auditadas. */
/** Contas por usuário (ex.: admin@tucai.example.com) mostram o usuário, não o e-mail técnico. */
export function loginLabel(email: string | null | undefined): string {
  if (!email) return ''
  return email.endsWith('@tucai.example.com') ? `usuário: ${email.split('@')[0]}` : email
}

export function AdminTeam() {
  const { session } = useAuth()
  const q = useQuery({ queryKey: ['admin', 'staff'], queryFn: listStaff })
  return (
    <>
      <AdminHeader title="Equipe administrativa" subtitle="Sócios e operadores com acesso ao painel, cada um com permissões específicas." />
      <AddOperator />
      {q.isLoading ? (
        <p role="status" className="text-sm text-ink-muted">Carregando…</p>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState icon={Users} title="Nenhum integrante" />
      ) : (
        <ul className="flex flex-col gap-3">
          {(q.data ?? []).map((m) => (
            <li key={m.userId}><MemberCard member={m} self={m.userId === session?.user.id} /></li>
          ))}
        </ul>
      )}
    </>
  )
}
