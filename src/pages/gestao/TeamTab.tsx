import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgePlus, Pencil, Trash2, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { sendInviteLink } from '../../features/account/repository.ts'
import {
  applyFunction, deleteFunction, FUNCTION_EXTRAS, inviteByUsername, inviteMember, listFunctions, listMemberExtras, listTeam, MEMBER_ROLE_LABEL,
  removeMember, saveFunction, setMemberPermission, setMemberRole, usernameExists, type FunctionExtra, type MemberRole, type TeamFunction,
} from '../../features/gestao/repository.ts'
import { useGestao } from './context.ts'
import { box, field, msg, primary, SectionTitle } from './ui.tsx'

type StaffRole = Exclude<MemberRole, 'owner'>
/** Cargos base. 'kitchen' continua válido para quem já tem, mas o Funcionário faz atendimento e cozinha. */
const ROLES: StaffRole[] = ['attendant', 'manager', 'courier_own']
const ROLE_HINT: Record<StaffRole, string> = {
  manager: 'Funcionário com acesso à gestão (relatórios e cardápio), sem equipe nem configurações sensíveis.',
  attendant: 'Recebe e atende pedidos, comandas e mesas, cozinha e status do preparo. Sem financeiro: libere extras se quiser.',
  kitchen: 'Cargo antigo: fila da cozinha e status dos pedidos.',
  courier_own: 'Entregador próprio: recebe só as entregas que a loja atribuir a ele.',
}
/** Valor do seletor "função": "fn:<id>" (função da loja) ou "role:<cargo>". */
type Pick = string
const fnValue = (id: string): Pick => 'fn:' + id

/** Funções da loja: o empresário cria (nome + cargo base + permissões) e usa para a equipe. */
function FunctionsPanel({ businessId, fns }: { businessId: string; fns: TeamFunction[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const empty = { id: null as string | null, name: '', baseRole: 'attendant' as StaffRole, extras: [] as FunctionExtra[] }
  const [f, setF] = useState(empty)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['gestao'] })
  const save = useMutation({
    mutationFn: () => saveFunction(businessId, f),
    onSuccess: () => { toast.success(f.id ? 'Função atualizada (vale para quem já a usa).' : 'Função criada.'); setF(empty); refresh() },
    onError: (e) => toast.error(msg(e)),
  })
  const del = useMutation({
    mutationFn: (id: string) => deleteFunction(businessId, id),
    onSuccess: () => { toast.success('Função apagada. Quem a usava continua na equipe.'); refresh() },
    onError: (e) => toast.error(msg(e)),
  })
  return (
    <section aria-labelledby="funcoes" className={`${box} flex flex-col gap-3`}>
      <h2 id="funcoes" className="flex items-center gap-2 text-base font-semibold text-ink"><BadgePlus aria-hidden="true" className="size-5" />Funções da equipe</h2>
      <p className="text-sm text-ink-muted">Crie funções com o nome que você usa na loja (ex.: Caixa, Balconista, Motoboy) e escolha o que cada uma pode fazer.</p>
      {fns.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
          {fns.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="font-semibold text-ink">{x.name}</span>
                <span className="block text-xs text-ink-muted">{MEMBER_ROLE_LABEL[x.baseRole]}{x.extras.length ? ` + ${x.extras.map((e) => FUNCTION_EXTRAS.find((y) => y.code === e)?.label ?? e).join(', ')}` : ''}</span>
              </span>
              <span className="flex gap-1">
                <button type="button" aria-label={`Editar ${x.name}`} onClick={() => setF({ id: x.id, name: x.name, baseRole: x.baseRole, extras: x.extras })} className="pressable grid size-10 place-items-center rounded-full hover:bg-muted"><Pencil aria-hidden="true" className="size-4" /></button>
                <button type="button" aria-label={`Apagar ${x.name}`} disabled={del.isPending} onClick={() => { if (window.confirm(`Apagar a função ${x.name}?`)) del.mutate(x.id) }} className="pressable grid size-10 place-items-center rounded-full text-danger hover:bg-muted"><Trash2 aria-hidden="true" className="size-4" /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="flex flex-col gap-3 rounded-2xl bg-muted p-3">
        <p className="text-sm font-semibold text-ink">{f.id ? `Editando: ${f.name}` : 'Nova função'}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-ink">Nome da função
            <input required maxLength={40} value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} placeholder="Ex.: Caixa" className={`${field} mt-1`} />
          </label>
          <label className="text-sm font-medium text-ink">Cargo base
            <select value={f.baseRole} onChange={(e) => setF((p) => ({ ...p, baseRole: e.target.value as StaffRole }))} className={`${field} mt-1`}>
              {ROLES.map((r) => <option key={r} value={r}>{MEMBER_ROLE_LABEL[r]}</option>)}
            </select>
          </label>
        </div>
        <p className="text-xs text-ink-muted">{ROLE_HINT[f.baseRole]}</p>
        <fieldset className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-medium text-ink">Pode também</legend>
          {FUNCTION_EXTRAS.map((x) => (
            <label key={x.code} className="inline-flex min-h-10 items-center gap-2 text-sm text-ink">
              <input type="checkbox" className="size-4" checked={f.extras.includes(x.code)}
                onChange={(e) => setF((p) => ({ ...p, extras: e.target.checked ? [...p.extras, x.code] : p.extras.filter((y) => y !== x.code) }))} />{x.label}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={save.isPending || f.name.trim().length < 2} className={primary}>{f.id ? 'Salvar função' : 'Criar função'}</button>
          {f.id && <button type="button" onClick={() => setF(empty)} className="pressable min-h-11 rounded-full border border-line px-4 text-sm font-semibold text-ink">Cancelar</button>}
        </div>
      </form>
    </section>
  )
}

function FunctionSelect({ value, onChange, fns, label, includeRole }: { value: Pick; onChange: (v: Pick) => void; fns: TeamFunction[]; label: string; includeRole?: string }) {
  const roles = includeRole && !ROLES.includes(includeRole as StaffRole) ? [...ROLES, includeRole as StaffRole] : ROLES
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="min-h-11 rounded-xl border border-line bg-surface px-3 text-sm text-ink">
      {fns.length > 0 && (
        <optgroup label="Funções da loja">{fns.map((f) => <option key={f.id} value={fnValue(f.id)}>{f.name}</option>)}</optgroup>
      )}
      <optgroup label="Cargos">{roles.map((r) => <option key={r} value={`role:${r}`}>{MEMBER_ROLE_LABEL[r]}</option>)}</optgroup>
    </select>
  )
}

/** Equipe: convite por nome de usuário (ou e-mail), funções da loja, cargo e permissões extras. Quem decide é o banco. */
export function TeamTab() {
  const { business: b, premium } = useGestao()
  const qc = useQueryClient()
  const toast = useToast()
  const team = useQuery({ queryKey: ['gestao', 'team', b.id], queryFn: () => listTeam(b.id) })
  const extras = useQuery({ queryKey: ['gestao', 'extras-all', b.id], queryFn: () => listMemberExtras(b.id) })
  const fns = useQuery({ queryKey: ['gestao', 'funcoes', b.id], queryFn: () => listFunctions(b.id) })
  const [by, setBy] = useState<'usuario' | 'email'>('usuario')
  const [who, setWho] = useState('')
  const [pick, setPick] = useState<Pick>('role:attendant')
  const [userCheck, setUserCheck] = useState<'ok' | 'nao_existe' | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['gestao'] })

  const checkUser = async () => {
    if (by !== 'usuario') { setUserCheck(null); return }
    const exists = await usernameExists(who)
    setUserCheck(exists === null ? null : exists ? 'ok' : 'nao_existe')
  }
  const invite = useMutation({
    mutationFn: async () => {
      const fn = pick.startsWith('fn:') ? pick.slice(3) : null
      const role = pick.startsWith('role:') ? (pick.slice(5) as StaffRole) : null
      if (by === 'usuario') return inviteByUsername(b.id, who, role, fn)
      const r = await inviteMember(b.id, who, role ?? fns.data?.find((f) => f.id === fn)?.baseRole ?? 'attendant')
      if (r === 'convidado') await sendInviteLink(who.trim()).catch(() => undefined)
      return r
    },
    onSuccess: (r) => {
      toast.success(r === 'vinculado' ? 'Pessoa adicionada à equipe.' : 'Convite enviado. O acesso é liberado quando a pessoa criar a conta com este e-mail.')
      setWho(''); setUserCheck(null)
      refresh()
    },
    onError: (e) => toast.error(msg(e)),
  })
  const change = useMutation({
    mutationFn: async (a: { kind: 'pick'; user: string; pick: Pick } | { kind: 'extra'; user: string; perm: FunctionExtra; on: boolean } | { kind: 'remove'; user: string | null; invite: string | null }) => {
      if (a.kind === 'pick') return a.pick.startsWith('fn:') ? applyFunction(b.id, a.user, a.pick.slice(3)) : setMemberRole(b.id, a.user, a.pick.slice(5) as StaffRole)
      if (a.kind === 'extra') return setMemberPermission(b.id, a.user, a.perm, a.on)
      if (!window.confirm('Remover esta pessoa da equipe?')) return
      return removeMember(b.id, a.user, a.invite)
    },
    onSuccess: () => refresh(),
    onError: (e) => toast.error(msg(e)),
  })
  const has = (user: string, perm: string) => (extras.data ?? []).some((x) => x.userId === user && x.permission === perm)
  const list = fns.data ?? []
  const pickRole = pick.startsWith('role:') ? (pick.slice(5) as StaffRole) : list.find((f) => fnValue(f.id) === pick)?.baseRole ?? 'attendant'

  return (
    <div className="flex flex-col gap-4">
      <SectionTitle title="Equipe" subtitle="Cada pessoa entra com a própria conta. Ninguém vê a senha de ninguém." />
      <form onSubmit={(e) => { e.preventDefault(); invite.mutate() }} className={`${box} flex flex-col gap-3`}>
        <div role="radiogroup" aria-label="Adicionar por" className="flex gap-2">
          {([['usuario', 'Nome de usuário'], ['email', 'E-mail']] as const).map(([k, l]) => (
            <label key={k} className={`pressable inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 px-4 text-sm font-semibold ${by === k ? 'border-brand bg-muted text-ink' : 'border-line text-ink'}`}>
              <input type="radio" name="adicionar-por" className="sr-only" checked={by === k} onChange={() => { setBy(k); setUserCheck(null) }} />{l}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_16rem_auto] sm:items-end">
          <label className="text-sm font-medium text-ink">{by === 'usuario' ? 'Nome de usuário da pessoa' : 'E-mail'}
            <input required type={by === 'email' ? 'email' : 'text'} autoCapitalize="none" spellCheck={false} value={who}
              onChange={(e) => { setWho(e.target.value); setUserCheck(null) }} onBlur={() => void checkUser()}
              placeholder={by === 'usuario' ? '@nome.de.usuario' : 'pessoa@email.com'} autoComplete="off" className={`${field} mt-1`} />
          </label>
          <label className="text-sm font-medium text-ink">Função
            <span className="mt-1 block"><FunctionSelect value={pick} onChange={setPick} fns={list} label="Função da pessoa" /></span>
          </label>
          <button type="submit" disabled={invite.isPending || userCheck === 'nao_existe'} className={primary}><UserPlus aria-hidden="true" className="size-4" />Adicionar</button>
        </div>
        {userCheck === 'nao_existe' && <p role="alert" className="text-sm font-semibold text-danger">Nome de usuário não encontrado. Confira com a pessoa e tente novamente.</p>}
        {userCheck === 'ok' && <p role="status" className="text-sm text-success">Usuário encontrado.</p>}
        <p className="text-xs text-ink-muted">{MEMBER_ROLE_LABEL[pickRole]}: {ROLE_HINT[pickRole]}</p>
      </form>

      <FunctionsPanel businessId={b.id} fns={list} />

      {team.isError ? <ErrorState error={team.error} onRetry={() => void team.refetch()} /> : (team.data ?? []).length === 0 ? (
        <EmptyState icon={Users} title={team.isLoading ? 'Carregando…' : 'Só você por enquanto'} />
      ) : (
        <ul className="flex flex-col gap-2">
          {(team.data ?? []).map((m) => (
            <li key={m.userId ?? m.inviteId} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 md:flex-row md:items-center">
              <div className="min-w-0 md:flex-1">
                <p className="truncate font-semibold text-ink">{m.name ?? m.email ?? 'Convidado'}</p>
                <p className="truncate text-sm text-ink-muted">{m.username ? `@${m.username} · ` : ''}{m.email}{m.pending ? ' · convite pendente' : ''}</p>
                {m.functionName && <p className="text-sm font-semibold text-ink">{m.functionName}</p>}
              </div>
              {m.role === 'owner' ? (
                <span className="w-fit rounded-full bg-muted px-3 py-1 text-xs font-semibold text-ink">{MEMBER_ROLE_LABEL.owner}</span>
              ) : (
                <div className="flex flex-col gap-2 md:items-end">
                  <div className="flex flex-wrap items-center gap-2">
                    {m.userId && !m.pending ? (
                      <FunctionSelect value={m.functionId ? fnValue(m.functionId) : 'role:' + m.role} includeRole={m.role}
                        onChange={(v) => change.mutate({ kind: 'pick', user: m.userId!, pick: v })} fns={list} label={`Função de ${m.name ?? m.email}`} />
                    ) : (
                      <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-ink">{MEMBER_ROLE_LABEL[m.role]}</span>
                    )}
                    <button type="button" onClick={() => change.mutate({ kind: 'remove', user: m.pending ? null : m.userId, invite: m.inviteId })} className="pressable min-h-11 rounded-full px-3 text-sm font-semibold text-danger hover:bg-muted">Remover</button>
                  </div>
                  {m.userId && !m.pending && premium && !m.functionId && (
                    <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
                      <legend className="sr-only">Permissões extras</legend>
                      {FUNCTION_EXTRAS.filter((x) => ['tabs.manage', 'cash.manage', 'reports.view'].includes(x.code)).map((x) => (
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
