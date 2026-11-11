import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, FlaskConical, Settings, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { createTestData, listCities, listTestData, removeTestData, type CreatedTestData } from '../../features/admin/repository.ts'
import { AdminHeader, dangerButton, errorMessage, formatDateTime, inputClass, Panel, primaryButton, secondaryButton } from './ui.tsx'

function copy(text: string, ok: () => void) {
  void navigator.clipboard?.writeText(text).then(ok, () => undefined)
}

function Created({ data, onClose }: { data: CreatedTestData; onClose: () => void }) {
  const toast = useToast()
  const all = [`Dados de teste — ${data.city}`, `Senha de todos: ${data.password}`, ...data.logins.map((l) => `${l.label}: ${l.email}`)].join('\n')
  return (
    <Panel className="flex flex-col gap-3 border-success">
      <h2 className="text-lg font-bold text-ink">Dados de teste criados em {data.city}</h2>
      <p role="alert" className="rounded-xl bg-muted p-3 text-sm text-ink">
        Copie agora: a senha aparece <strong>só desta vez</strong>. Todos os logins abaixo usam a mesma senha.
      </p>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        Senha: <code className="rounded-lg bg-muted px-2 py-1 text-base font-bold tracking-wide text-ink">{data.password}</code>
      </p>
      <ul className="divide-y divide-line text-sm">
        {data.logins.map((l) => (
          <li key={l.email} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-ink-muted">{l.label}</span>
            <code className="break-all text-ink">{l.email}</code>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => copy(all, () => toast.success('Logins e senha copiados.'))} className={primaryButton}><Copy aria-hidden="true" className="size-4" />Copiar tudo</button>
        <button type="button" onClick={onClose} className={secondaryButton}>Já copiei</button>
      </div>
      <p className="text-xs text-ink-muted">
        Clientes e lojistas entram em /entrar; o entregador vê as ofertas em Área do entregador. Os estabelecimentos aparecem com “[Teste]” no nome, abertos o dia todo.
      </p>
    </Panel>
  )
}

function TestDataSection() {
  const qc = useQueryClient()
  const toast = useToast()
  const cities = useQuery({ queryKey: ['admin', 'cities'], queryFn: listCities })
  const runs = useQuery({ queryKey: ['admin', 'test-data'], queryFn: listTestData })
  const [cityId, setCityId] = useState('')
  const [created, setCreated] = useState<CreatedTestData | null>(null)
  const active = (cities.data ?? []).filter((c) => c.isActive)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'test-data'] })
    void qc.invalidateQueries({ queryKey: ['catalog'] })
    void qc.invalidateQueries({ queryKey: ['store'] })
  }
  const create = useMutation({
    mutationFn: () => createTestData(cityId),
    onSuccess: (d) => { setCreated(d); refresh() },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: removeTestData,
    onSuccess: () => { toast.success('Dados de teste removidos.'); refresh() },
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <section aria-labelledby="dados-teste" className="flex flex-col gap-3">
      <h2 id="dados-teste" className="flex items-center gap-2 text-lg font-bold text-ink"><FlaskConical aria-hidden="true" className="size-5" />Dados de teste</h2>
      <Panel className="flex flex-col gap-3 text-sm">
        <p className="text-ink">
          Cria na cidade escolhida: <strong>2 estabelecimentos</strong> com cardápio e horários (um com entregador parceiro, outro com entrega própria),
          <strong> 1 entregador aprovado</strong>, <strong>1 vaga</strong> e <strong>logins de 2 clientes e 2 lojistas</strong> para simular pedidos de ponta a ponta.
        </p>
        <p className="text-ink-muted">Tudo fica marcado como “[Teste]” e pode ser removido aqui. Use em produção só para validar e remova depois.</p>
        {cities.isError ? (
          <ErrorState error={cities.error} onRetry={() => void cities.refetch()} />
        ) : (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (cityId) create.mutate()
            }}
          >
            <div className="min-w-56 flex-1">
              <label htmlFor="td-city" className="mb-1 block text-sm font-medium text-ink">Cidade</label>
              <select id="td-city" value={cityId} onChange={(e) => setCityId(e.target.value)} className={inputClass}>
                <option value="">{cities.isLoading ? 'Carregando…' : 'Escolha a cidade'}</option>
                {active.map((c) => <option key={c.id} value={c.id}>{c.name} - {c.state}</option>)}
              </select>
            </div>
            <button type="submit" disabled={!cityId || create.isPending} className={primaryButton}>
              <FlaskConical aria-hidden="true" className="size-4" />{create.isPending ? 'Criando…' : 'Criar dados de teste'}
            </button>
          </form>
        )}
      </Panel>
      {created && <Created data={created} onClose={() => setCreated(null)} />}
      <h3 className="text-base font-semibold text-ink">Lotes criados</h3>
      {runs.isError ? (
        <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />
      ) : (runs.data ?? []).length === 0 ? (
        <p className="text-sm text-ink-muted">{runs.isLoading ? 'Carregando…' : 'Nenhum dado de teste no momento.'}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(runs.data ?? []).map((r) => (
            <li key={r.runId}>
              <Panel className="flex flex-col gap-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{r.city ?? 'Cidade removida'} · {formatDateTime(r.createdAt)} · {r.businesses} estabelecimentos</span>
                  <button
                    type="button"
                    disabled={remove.isPending}
                    onClick={() => { if (window.confirm('Remover este lote? Apaga os estabelecimentos, pedidos, entregador e logins de teste.')) remove.mutate(r.runId) }}
                    className={dangerButton}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />Remover
                  </button>
                </div>
                <ul className="text-ink-muted">
                  {r.logins.map((l) => <li key={l.email}>{l.label}: <code className="break-all text-ink">{l.email}</code></li>)}
                </ul>
                <p className="text-xs text-ink-muted">A senha não é guardada. Se perdeu, remova o lote e crie outro.</p>
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Configurações do Master. */
export function AdminSettings() {
  return (
    <div className="flex flex-col gap-6">
      <AdminHeader title="Configurações" subtitle="Ferramentas do Master para operar e testar a plataforma." />
      <Panel className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 text-ink"><ShieldCheck aria-hidden="true" className="size-5" />Verificação em duas etapas e exigência de MFA da equipe</span>
        <Link to="/admin/seguranca" className={secondaryButton}><Settings aria-hidden="true" className="size-4" />Abrir Segurança</Link>
      </Panel>
      <TestDataSection />
    </div>
  )
}
