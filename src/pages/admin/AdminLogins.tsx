import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, KeyRound, Pencil, Search, ShieldCheck, UserRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { FilterChips } from '../../components/nav/FilterChips.tsx'
import {
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

function AccountRow({ a, canEdit }: { a: Account; canEdit: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [open, setOpen] = useState<Panel>(null)
  const [value, setValue] = useState('')
  const [shownPassword, setShownPassword] = useState<string | null>(null)
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
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => start('name')} className={secondaryButton}><Pencil aria-hidden="true" className="size-4" />Nome</button>
          <button type="button" onClick={() => start('username')} className={secondaryButton}><UserRound aria-hidden="true" className="size-4" />Usuário</button>
          <button type="button" onClick={() => start('password')} className={secondaryButton}><KeyRound aria-hidden="true" className="size-4" />Nova senha</button>
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
            {open === 'name' ? 'Nome completo' : open === 'username' ? 'Novo usuário (3 a 30 letras, números, ponto ou sublinhado; vazio remove)' : 'Nova senha (gerada; você pode editar)'}
            <input value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" spellCheck={false} className={inputClass} />
          </label>
          <button type="submit" disabled={run.isPending} className={primaryButton}>{run.isPending ? 'Salvando…' : 'Salvar'}</button>
          <button type="button" onClick={() => setOpen(null)} className={secondaryButton}>Cancelar</button>
          {open === 'password' && <p className="w-full text-xs text-ink-muted">Passe a senha para a pessoa por um canal seguro e peça para trocá-la em Minha conta → Alterar senha.</p>}
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
