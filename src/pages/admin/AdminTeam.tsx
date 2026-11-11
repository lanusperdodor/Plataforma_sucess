import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus, Users } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { useAuth } from '../../features/auth/AuthProvider.tsx'
import {
  PLATFORM_PERMISSION_CODES,
  grantMaster,
  inviteStaff,
  listInvites,
  listStaff,
  revokeInvite,
  revokeMaster,
  revokeOperatorRole,
  setStaffPermission,
  type StaffMember,
  type StaffRole,
} from '../../features/admin/repository.ts'
import { sendInviteLink } from '../../features/account/repository.ts'
import { AdminHeader, dangerButton, errorMessage, inputClass, Panel, primaryButton, secondaryButton } from './ui.tsx'

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
  const master = useMutation({
    mutationFn: (grant: boolean) => (grant ? grantMaster(member.userId) : revokeMaster(member.userId)),
    onSuccess: (_d, grant) => { toast.success(grant ? 'Acesso Master concedido (registrado na auditoria).' : 'Acesso Master removido.'); refresh() },
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
        <>
          <p className="text-sm text-ink-muted">O Master tem todas as permissões. A plataforma nunca fica sem Master: o último não pode ser removido.</p>
          {!self && (
            <button type="button" disabled={master.isPending} onClick={() => { if (window.confirm('Remover o acesso Master desta pessoa?')) master.mutate(false) }} className={`${dangerButton} w-fit`}>
              Remover acesso Master
            </button>
          )}
        </>
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
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={remove.isPending} onClick={() => remove.mutate()} className={`${dangerButton} w-fit`}>
                Remover da equipe
              </button>
              <button type="button" disabled={master.isPending}
                onClick={() => { if (window.prompt('Acesso Master dá controle total e exige MFA. Digite CONCEDER MASTER para confirmar:') === 'CONCEDER MASTER') master.mutate(true) }}
                className={`${secondaryButton} w-fit`}>
                Promover a Master
              </button>
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

function InviteMember() {
  const qc = useQueryClient()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<StaffRole>('platform_operator')
  const [perms, setPerms] = useState<string[]>([])
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string>()
  const send = useMutation({
    mutationFn: async () => {
      const value = email.trim().toLowerCase()
      const result = await inviteStaff(value, role, role === 'platform_operator' ? perms : [], confirm)
      if (result === 'convidado') await sendInviteLink(value)
      return { result, value }
    },
    onSuccess: ({ result, value }) => {
      toast.success(result === 'vinculado'
        ? `${value} já tinha conta: o acesso foi vinculado agora, sem criar outra conta.`
        : `Convite enviado para ${value}. O acesso é liberado quando a pessoa abrir o link.`)
      setEmail(''); setPerms([]); setConfirm('')
      void qc.invalidateQueries({ queryKey: ['admin'] })
    },
    onError: (e) => setError(errorMessage(e)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(undefined)
    send.mutate()
  }
  return (
    <Panel className="mb-4">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-base font-bold text-ink"><UserPlus aria-hidden="true" className="size-5" />Convidar integrante</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-sm font-medium text-ink">E-mail da pessoa
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </label>
          <label className="text-sm font-medium text-ink">Nível de acesso
            <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} className={inputClass}>
              <option value="platform_operator">Operador administrativo (permissões escolhidas abaixo)</option>
              <option value="platform_master">Administrador Master (acesso total)</option>
            </select>
          </label>
        </div>
        {role === 'platform_operator' ? (
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-ink">Permissões</legend>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {PLATFORM_PERMISSION_CODES.map((code) => (
                <label key={code} className="flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm text-ink hover:bg-muted">
                  <input type="checkbox" className="size-5" checked={perms.includes(code)}
                    onChange={(e) => setPerms((p) => (e.target.checked ? [...p, code] : p.filter((x) => x !== code)))} />
                  {PERMISSION_LABEL[code]}
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <label className="rounded-xl bg-orange/15 p-3 text-sm text-ink">
            Acesso Master dá controle total da plataforma. Exige a verificação em duas etapas ativa na sua sessão e fica na auditoria.
            Para confirmar, digite <strong>CONCEDER MASTER</strong>:
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} className={`${inputClass} mt-1`} autoComplete="off" />
          </label>
        )}
        <button type="submit" disabled={send.isPending || (role === 'platform_master' && confirm !== 'CONCEDER MASTER')} className={`${primaryButton} w-fit`}>
          {send.isPending ? 'Enviando…' : 'Enviar convite'}
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <p className="mt-2 text-xs text-ink-muted">
        Nenhuma senha é enviada: a pessoa recebe um link seguro, entra e cria a própria senha em Minha conta. Se o e-mail já tem conta, o acesso é vinculado a ela.
        Cliente não recebe poderes administrativos; lojista e entregador entram pelos próprios cadastros e aprovações.
      </p>
    </Panel>
  )
}

function Invites() {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['admin', 'invites'], queryFn: listInvites })
  const revoke = useMutation({
    mutationFn: revokeInvite,
    onSuccess: () => { toast.success('Convite cancelado.'); void qc.invalidateQueries({ queryKey: ['admin', 'invites'] }) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const resend = useMutation({
    mutationFn: sendInviteLink,
    onSuccess: () => toast.success('Link reenviado.'),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const rows = q.data ?? []
  if (q.isError || rows.length === 0) return null
  return (
    <Panel className="mb-4 text-sm">
      <h2 className="mb-2 text-base font-bold text-ink">Convites</h2>
      <ul className="divide-y divide-line">
        {rows.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="text-ink">{i.email} · {i.role === 'platform_master' ? 'Master' : 'Operador'} · <span className="text-ink-muted">{i.status}</span></span>
            {i.status === 'pendente' && (
              <span className="flex gap-2">
                <button type="button" onClick={() => resend.mutate(i.email)} disabled={resend.isPending} className={secondaryButton}>Reenviar link</button>
                <button type="button" onClick={() => revoke.mutate(i.id)} disabled={revoke.isPending} className={dangerButton}>Cancelar</button>
              </span>
            )}
          </li>
        ))}
      </ul>
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
      <InviteMember />
      <Invites />
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
