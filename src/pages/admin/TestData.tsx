import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, FlaskConical, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { CityCombobox } from '../../components/forms/CityCombobox.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { createTestData, getTestAccountsStatus, listCities, listTestData, removeAllTestData, removeTestData, standardizeTestAccounts, type CreatedTestData } from '../../features/admin/repository.ts'
import { dangerButton, errorMessage, formatDateTime, inputClass, Panel, primaryButton, secondaryButton } from './ui.tsx'

/** Contas de homologação por cidade (9 perfis, 3 estabelecimentos de teste), sem duplicar e com remoção completa. */
function copy(text: string, ok: () => void) {
  void navigator.clipboard?.writeText(text).then(ok, () => undefined)
}

function Created({ data, onClose }: { data: CreatedTestData; onClose: () => void }) {
  const toast = useToast()
  const all = [`Dados de teste — ${data.city}`, `Senha das contas novas: ${data.password ?? ''}`, ...data.logins.map((l) => `${l.label}: ${l.email}`)].join('\n')
  if (data.logins.length === 0) {
    return (
      <Panel className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-ink">Nada a criar em {data.city}</h2>
        <p className="text-sm text-ink">Todos os perfis de homologação já existem no lote desta cidade. Nenhuma conta foi duplicada. Se perdeu a senha, defina uma nova na lista de contas acima.</p>
        <button type="button" onClick={onClose} className={secondaryButton}>Entendi</button>
      </Panel>
    )
  }
  return (
    <Panel className="flex flex-col gap-3 border-success">
      <h2 className="text-lg font-bold text-ink">{data.reused ? 'Perfis que faltavam criados' : 'Contas de homologação criadas'} em {data.city}</h2>
      <p role="alert" className="rounded-xl bg-muted p-3 text-sm text-ink">
        Copie agora: a senha aparece <strong>só desta vez</strong>. Os logins abaixo usam a mesma senha{data.reused ? '; as contas que já existiam mantêm a senha anterior' : ''}.
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
        Todos entram pelo mesmo login (/entrar), que reconhece o perfil e abre o painel certo. Os estabelecimentos “[Teste]” ficam abertos o dia todo e só aparecem para contas de teste e para a equipe:
        clientes reais não os veem, contas de teste não compram em lojas reais e entregadores reais não recebem ofertas de teste.
      </p>
    </Panel>
  )
}

export function TestDataSection() {
  const qc = useQueryClient()
  const toast = useToast()
  const cities = useQuery({ queryKey: ['admin', 'cities'], queryFn: listCities })
  const runs = useQuery({ queryKey: ['admin', 'test-data'], queryFn: listTestData })
  const [cityId, setCityId] = useState('')
  const [created, setCreated] = useState<CreatedTestData | null>(null)
  const active = (cities.data ?? []).filter((c) => c.isActive)
  const status = useQuery({ queryKey: ['admin', 'test-data', 'status'], queryFn: getTestAccountsStatus, retry: false })
  const [stdWord, setStdWord] = useState('')
  const standardize = useMutation({
    mutationFn: () => standardizeTestAccounts(cityId, stdWord),
    onSuccess: (r) => {
      toast.success(`Padronizado: ${r.removedAccounts} conta(s) excedente(s) removida(s); ${r.created.logins.length} conta(s) criada(s).`)
      setStdWord('')
      if (r.created.logins.length > 0) setCreated(r.created)
      refresh()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
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
  const [purging, setPurging] = useState(false)
  const [word, setWord] = useState('')
  const removeAll = useMutation({
    mutationFn: () => removeAllTestData(word),
    onSuccess: (r) => {
      toast.success(`Dados de teste excluídos: ${r.lotes} lote(s), ${r.estabelecimentos} estabelecimento(s), ${r.pedidos} pedido(s), ${r.logins} login(s).`)
      setPurging(false); setWord(''); setCreated(null); refresh()
      void qc.invalidateQueries({ queryKey: ['admin'] })
    },
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
          Cria na cidade escolhida as <strong>sete contas operacionais</strong> de homologação: <strong>Empresário 1 — Lanchonete</strong>,{' '}
          <strong>Empresário 2 — Supermercado</strong>, <strong>Funcionário — Lanchonete</strong> (atendimento e cozinha),{' '}
          <strong>Entregador 1 — Independente</strong>, <strong>Entregador 2 — Próprio do supermercado</strong>, <strong>Cliente 1</strong> e <strong>Cliente 2</strong>.
          O Master é você. Se a cidade já tiver um lote neste formato, só cria as contas que faltam.
        </p>
        <p className="text-ink-muted">Tudo fica marcado como teste, isolado dos clientes, lojas e entregadores reais, fora do financeiro, e pode ser removido aqui.</p>
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
              <CityCombobox id="td-city" label="Cidade" cities={active} value={cityId} onChange={setCityId} loading={cities.isLoading} />
            </div>
            <button type="submit" disabled={!cityId || create.isPending} className={primaryButton}>
              <FlaskConical aria-hidden="true" className="size-4" />{create.isPending ? 'Criando…' : 'Criar dados de teste'}
            </button>
          </form>
        )}
      </Panel>
      {status.data && (
        <Panel className={`flex flex-col gap-2 text-sm ${status.data.padrao ? '' : 'border-warm'}`}>
          <p className="font-semibold text-ink" role="status">
            {status.data.padrao
              ? `Padrão em dia: exatamente 7 contas de teste${status.data.cidade ? ` em ${status.data.cidade}` : ''}.`
              : status.data.contas === 0
                ? 'Nenhuma conta de teste ainda. Escolha a cidade acima e crie as 7.'
                : `${status.data.contas} conta(s) de teste ativa(s) — o padrão é exatamente 7, num único conjunto.`}
          </p>
          {status.data.excedentes.length > 0 && (
            <div>
              <p className="text-ink">Fora do padrão (serão removidas ao padronizar):</p>
              <ul className="list-disc pl-5 text-ink-muted">{status.data.excedentes.map((x) => <li key={x.email ?? x.label}>{x.label}: <code className="break-all">{x.email}</code></li>)}</ul>
            </div>
          )}
          {status.data.faltando.length > 0 && status.data.contas > 0 && <p className="text-ink-muted">Faltando no conjunto padrão: {status.data.faltando.length} conta(s).</p>}
          {status.data.bloqueios.length > 0 && (
            <div role="alert" className="rounded-xl bg-muted p-3 text-ink">
              <p className="font-semibold">Estas contas de teste têm vínculo com dados reais e impedem a padronização (nada será removido):</p>
              <ul className="list-disc pl-5">{status.data.bloqueios.map((b) => <li key={b.email ?? ''}>{b.email}: {b.motivos.join(', ')}</li>)}</ul>
            </div>
          )}
          {!status.data.padrao && status.data.contas > 0 && (
            <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); standardize.mutate() }}>
              <p className="w-full text-ink-muted">Padronizar remove as contas de teste excedentes (só depois de verificar dependências; usuários reais nunca entram) e deixa as 7 contas na cidade escolhida acima.</p>
              <div className="min-w-56 flex-1">
                <label htmlFor="td-std" className="mb-1 block text-sm font-medium text-ink">Digite <strong>PADRONIZAR</strong> para confirmar</label>
                <input id="td-std" value={stdWord} onChange={(e) => setStdWord(e.target.value)} autoComplete="off" className={inputClass} />
              </div>
              <button type="submit" disabled={!cityId || standardize.isPending || stdWord.trim().toUpperCase() !== 'PADRONIZAR'} className={primaryButton}>
                {standardize.isPending ? 'Padronizando…' : 'Padronizar as 7 contas'}
              </button>
              {!cityId && <p className="w-full text-xs text-ink-muted">Escolha a cidade no campo acima.</p>}
            </form>
          )}
        </Panel>
      )}
      {created && <Created data={created} onClose={() => setCreated(null)} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-ink">Lotes criados</h3>
        <button type="button" onClick={() => setPurging((v) => !v)} aria-expanded={purging} className={dangerButton}>
          <Trash2 aria-hidden="true" className="size-4" />Excluir todos os dados de teste
        </button>
      </div>
      {purging && (
        <Panel className="flex flex-col gap-3 text-sm">
          <p className="text-ink">
            Apaga <strong>todos</strong> os lotes de teste de todas as cidades: estabelecimentos “[Teste]”, pedidos, entregas, comandas, caixas,
            cobranças, campanhas e os logins de teste. Dados reais não são tocados. Não dá para desfazer.
          </p>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); removeAll.mutate() }}>
            <div className="min-w-56 flex-1">
              <label htmlFor="td-purge" className="mb-1 block text-sm font-medium text-ink">Digite <strong>EXCLUIR</strong> para confirmar</label>
              <input id="td-purge" value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" className={inputClass} />
            </div>
            <button type="submit" disabled={removeAll.isPending || word.trim().toUpperCase() !== 'EXCLUIR'} className={dangerButton}>
              {removeAll.isPending ? 'Excluindo…' : 'Excluir tudo'}
            </button>
            <button type="button" onClick={() => { setPurging(false); setWord('') }} className={secondaryButton}>Cancelar</button>
          </form>
        </Panel>
      )}
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

