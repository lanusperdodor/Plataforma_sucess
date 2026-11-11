import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Info, KeyRound, Mail, Pencil, Search, ShieldCheck, UserRound } from 'lucide-react'
import { Fragment, useState, type FormEvent } from 'react'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { FilterChips } from '../../components/nav/FilterChips.tsx'
import { sendPasswordRecoveryEmail } from '../../features/account/repository.ts'
import {
  accountDetail,
  startPasswordRecovery,
  listAccounts,
  setAccountBlocked,
  setAccountName,
  setAccountPassword,
  setAccountUsername,
  type Account,
  type AccountKind,
} from '../../features/admin/repository.ts'
import { useAdminAccess } from './access-context.ts'
import { TestDataSection } from './TestData.tsx'
import { AdminHeader, dangerButton, errorMessage, formatDateTime, inputClass, Panel, primaryButton, secondaryButton } from './ui.tsx'

const ROLE_LABEL: Record<string, string> = {
  customer: 'Cliente',
  merchant_owner: 'Lojista',
  courier_partner: 'Entregador',
  platform_operator: 'Equipe',
  platform_master: 'Master',
}
const KINDS = [
  { value: 'todos', label: 'Todas' },
  { value: 'reais', label: 'Reais' },
  { value: 'teste', label: 'Teste' },
] as const

/** Senha provisória forte para passar ao usuário (ele troca em Minha conta). */
export function tempPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  const body = [...bytes].map((b) => alphabet[b % alphabet.length]).join('')
  return `Tucai-${body}9`
}

/** E-mail técnico das contas por usuário não é um e-mail real. */
const shownEmail = (email: string | null) => (email && !email.endsWith('@tucai.example.com') ? email : null)

type Panel = 'name' | 'username' | 'password' | null

const ROLE_NAMES: Record<string, string> = { ...ROLE_LABEL, business_owner: 'Proprietário', business_staff: 'Funcionário', courier_own: 'Entregador da loja', service_provider: 'Prestador de serviços' }
const MEMBER_NAMES: Record<string, string> = { owner: 'Proprietário', manager: 'Gerente', attendant: 'Atendente', kitchen: 'Cozinha', courier_own: 'Entregador da loja' }

function AccountDetails({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['admin', 'account', id], queryFn: () => accountDetail(id) })
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const d = q.data
  if (!d) return <p role="status" className="text-ink-muted">Carregando…</p>
  return (
    <div className="grid gap-3 rounded-xl border border-line p-3 md:grid-cols-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-ink-muted">Situação</dt><dd className="text-ink">{d.blocked ? 'Bloqueada' : 'Ativa'}{d.email_confirmed ? ' · e-mail confirmado' : ' · e-mail não confirmado'}{d.must_change_password ? ' · troca de senha pendente' : ''}</dd>
        <dt className="text-ink-muted">Papéis</dt><dd className="text-ink">{d.roles.map((r) => ROLE_NAMES[r] ?? r).join(', ') || '—'}</dd>
        {d.permissions.length > 0 && (<><dt className="text-ink-muted">Permissões</dt><dd className="text-ink">{d.permissions.join(', ')}</dd></>)}
        {d.memberships.map((m) => (<Fragment key={m.business_id}><dt className="text-ink-muted">Estabelecimento</dt><dd className="text-ink">{m.business} · {MEMBER_NAMES[m.role] ?? m.role}</dd></Fragment>))}
        {d.courier && (<><dt className="text-ink-muted">Entregador</dt><dd className="text-ink">{d.courier.status} · {d.courier.city ?? '—'} · {d.courier.is_online ? 'online' : 'offline'}</dd></>)}
        <dt className="text-ink-muted">Pedidos feitos</dt><dd className="text-ink">{d.orders}</dd>
      </dl>
      <div>
        <h4 className="mb-1 font-semibold text-ink">Alterações administrativas nesta conta</h4>
        {d.audit.length === 0 ? <p className="text-ink-muted">Nenhuma registrada.</p> : (
          <ul className="flex flex-col gap-1">
            {d.audit.map((a, n) => <li key={n} className="text-ink"><span className="text-ink-muted">{formatDateTime(a.created_at)}</span> · {a.action}{a.actor ? ` · por ${a.actor}` : ''}</li>)}
          </ul>
        )}
      </div>
    </div>
  )
}

function AccountRow({ a, canEdit }: { a: Account; canEdit: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [open, setOpen] = useState<Panel>(null)
  const [value, setValue] = useState('')
  const [shownPassword, setShownPassword] = useState<string | null>(null)
  const [details, setDetails] = useState(false)
  const recovery = useMutation({
    mutationFn: async () => {
      const email = await startPasswordRecovery(a.id)
      await sendPasswordRecoveryEmail(email)
      return email
    },
    onSuccess: (email) => toast.success(`Link de recuperação enviado para ${email}. A pessoa cria a nova senha pelo link.`),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const done = (msg: string) => {
    toast.success(msg)
    setOpen(null)
    setValue('')
    void qc.invalidateQueries({ queryKey: ['admin', 'accounts'] })
  }
  const run = useMutation({
    mutationFn: async (action: Exclude<Panel, null> | 'block' | 'unblock') => {
      if (action === 'name') await setAccountName(a.id, value)
      if (action === 'username') await setAccountUsername(a.id, value)
      if (action === 'password') await setAccountPassword(a.id, value)
      if (action === 'block' || action === 'unblock') await setAccountBlocked(a.id, action === 'block')
      return action
    },
    onSuccess: (action) => {
      if (action === 'password') setShownPassword(value)
      done(
        action === 'name' ? 'Nome alterado.' : action === 'username' ? 'Usuário alterado.' : action === 'password' ? 'Senha alterada.' : action === 'block' ? 'Conta bloqueada.' : 'Conta desbloqueada.',
      )
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const start = (p: Exclude<Panel, null>) => {
    setShownPassword(null)
    setOpen(open === p ? null : p)
    setValue(p === 'name' ? a.fullName ?? '' : p === 'username' ? a.username ?? '' : tempPassword())
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (open) run.mutate(open)
  }
  const email = shownEmail(a.email)
  return (
    <Panel className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-9 place-items-center rounded-full bg-muted text-ink"><UserRound aria-hidden="true" className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-ink">{a.fullName || a.username || email || 'Sem nome'}</p>
          <p className="truncate text-ink-muted">
            {a.username ? <>usuário <strong className="text-ink">{a.username}</strong></> : 'sem usuário'}
            {email && <> · {email}</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {a.isTest && <span className="rounded-full bg-orange/15 px-2 py-0.5 text-xs font-semibold text-accent">Teste</span>}
          {a.blocked && <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">Bloqueada</span>}
          {a.roles.filter((r) => r !== 'customer' || a.roles.length === 1).map((r) => (
            <span key={r} className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-ink">{ROLE_LABEL[r] ?? r}</span>
          ))}
        </div>
      </div>
      <p className="text-xs text-ink-muted">
        Criada em {formatDateTime(a.createdAt)} · último acesso {a.lastSignInAt ? formatDateTime(a.lastSignInAt) : 'nunca'}{a.phone ? ` · ${a.phone}` : ''}
      </p>
      <div>
        <button type="button" aria-expanded={details} onClick={() => setDetails((v) => !v)} className={`${secondaryButton}`}><Info aria-hidden="true" className="size-4" />{details ? 'Ocultar detalhes' : 'Ver detalhes'}</button>
      </div>
      {details && <AccountDetails id={a.id} />}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => start('name')} className={secondaryButton}><Pencil aria-hidden="true" className="size-4" />Nome</button>
          <button type="button" onClick={() => start('username')} className={secondaryButton}><UserRound aria-hidden="true" className="size-4" />Usuário</button>
          {email && (
            <button type="button" disabled={recovery.isPending} onClick={() => { if (window.confirm(`Enviar link de recuperação de senha para ${email}?`)) recovery.mutate() }} className={secondaryButton}>
              <Mail aria-hidden="true" className="size-4" />{recovery.isPending ? 'Enviando…' : 'Enviar recuperação de senha'}
            </button>
          )}
          <button type="button" onClick={() => start('password')} className={secondaryButton}><KeyRound aria-hidden="true" className="size-4" />Senha temporária</button>
          {a.blocked ? (
            <button type="button" disabled={run.isPending} onClick={() => run.mutate('unblock')} className={secondaryButton}><ShieldCheck aria-hidden="true" className="size-4" />Desbloquear</button>
          ) : (
            <button type="button" disabled={run.isPending} onClick={() => { if (window.confirm('Bloquear esta conta? A pessoa não conseguirá entrar até ser desbloqueada.')) run.mutate('block') }} className={dangerButton}><Ban aria-hidden="true" className="size-4" />Bloquear</button>
          )}
        </div>
      )}
      {open && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-xl border border-line p-3">
          <label className="min-w-56 flex-1 text-xs font-medium text-ink">
            {open === 'name' ? 'Nome completo' : open === 'username' ? 'Novo usuário (3 a 30 letras, números, ponto ou sublinhado; vazio remove)' : 'Senha temporária (gerada; você pode editar)'}
            <input value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" spellCheck={false} className={inputClass} />
          </label>
          <button type="submit" disabled={run.isPending} className={primaryButton}>{run.isPending ? 'Salvando…' : 'Salvar'}</button>
          <button type="button" onClick={() => setOpen(null)} className={secondaryButton}>Cancelar</button>
          {open === 'password' && (
            <p className="w-full text-xs text-ink-muted">
              Para contas de teste ou casos excepcionais. Conta real: só o Master com verificação em duas etapas ativa (prefira o link de recuperação).
              A pessoa é obrigada a criar uma senha nova no primeiro acesso. Passe a senha por um canal seguro.
            </p>
          )}
        </form>
      )}
      {shownPassword && (
        <p role="status" className="rounded-xl bg-muted p-2 text-sm text-ink">
          Nova senha: <code className="font-bold">{shownPassword}</code> · login: <strong>{a.username || email}</strong>. Ela não fica salva em lugar nenhum: anote agora.
        </p>
      )}
    </Panel>
  )
}

/** Logins: contas reais e de teste, com suporte para nome, usuário, senha e bloqueio. */
export function AdminLogins() {
  const access = useAdminAccess()
  const canEdit = (access.isMaster && access.mfaOk) || access.permissions.includes('support.manage')
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [kind, setKind] = useState<AccountKind>('todos')
  const [page, setPage] = useState(0)
  const size = 30
  const q = useQuery({ queryKey: ['admin', 'accounts', term, kind, page], queryFn: () => listAccounts(term, kind, size, page * size) })
  const total = q.data?.[0]?.total ?? 0
  return (
    <div className="flex flex-col gap-6">
      <AdminHeader title="Logins" subtitle="Contas de clientes, lojistas, entregadores e equipe. Suporte para nome, usuário, senha e bloqueio." />
      <Panel className="flex flex-col gap-3">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setPage(0)
            setTerm(search)
          }}
        >
          <label className="min-w-56 flex-1 text-sm font-medium text-ink">
            Buscar por nome, usuário ou e-mail
            <span className="relative block">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputClass} pl-9`} />
            </span>
          </label>
          <button type="submit" className={primaryButton}>Buscar</button>
        </form>
        <FilterChips label="Tipo de conta" options={KINDS.map((k) => ({ value: k.value, label: k.label }))} value={kind} onChange={(v) => { setPage(0); setKind(v as AccountKind) }} />
        <p className="text-xs text-ink-muted">
          A própria pessoa troca senha e usuário em <strong>Minha conta</strong>. Se não conseguir, ela chama o suporte e a alteração é feita aqui. Contas da equipe só podem ser alteradas por um Master. Tudo fica na Auditoria.
        </p>
      </Panel>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <p className="text-sm text-ink-muted">{q.isLoading ? 'Carregando…' : 'Nenhuma conta encontrada.'}</p>
      ) : (
        <>
          <p className="text-sm text-ink-muted" aria-live="polite">{total} {total === 1 ? 'conta' : 'contas'}</p>
          <ul className="flex flex-col gap-2">{(q.data ?? []).map((a) => <li key={a.id}><AccountRow a={a} canEdit={canEdit} /></li>)}</ul>
          {total > size && (
            <div className="flex items-center gap-2">
              <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className={secondaryButton}>Anterior</button>
              <span className="text-sm text-ink-muted">Página {page + 1} de {Math.ceil(total / size)}</span>
              <button type="button" disabled={(page + 1) * size >= total} onClick={() => setPage((p) => p + 1)} className={secondaryButton}>Próxima</button>
            </div>
          )}
        </>
      )}
      <TestDataSection />
    </div>
  )
}
