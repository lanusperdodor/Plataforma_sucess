import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, Clock, Minus, Plus, Printer, Search, Settings2, Users, UtensilsCrossed, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import {
  addTabItems, cancelTab, cancelTabItem, closeTab, createTables, getBoard, getCashStatus, listTabItems, listTables, newOpId, openTab,
  requestClose, saveTable, setItemStatus, transferTab, type BoardCard, type PayMethod, type Situation, type TabItem,
} from '../../features/gestao/repository.ts'
import { listProducts } from '../../features/merchant/repository.ts'
import { formatBRL } from '../../lib/money.ts'
import { useGestao } from './context.ts'
import { TableQrSheet } from './TableQr.tsx'
import { box, field, ghost, msg, parseCents, primary, secondary, SectionTitle, since } from './ui.tsx'

/** Cores discretas por situação (ponto + leve tom de fundo); o texto sempre acompanha a cor. */
export const SITUATION: Record<Situation, { label: string; hint: string; dot: string; tint: string }> = {
  livre: { label: 'Livre', hint: 'Disponível para atendimento', dot: 'bg-success', tint: 'bg-surface' },
  ocupada: { label: 'Ocupada', hint: 'Comanda aberta', dot: 'bg-brand', tint: 'bg-surface' },
  em_preparo: { label: 'Em preparo', hint: 'Cozinha trabalhando', dot: 'bg-warm', tint: 'bg-warm-soft' },
  pronto: { label: 'Pronto', hint: 'Itens prontos para servir', dot: 'bg-success', tint: 'bg-success/10' },
  aguardando_pagamento: { label: 'Aguardando pagamento', hint: 'Solicitou fechamento', dot: 'bg-danger', tint: 'bg-danger/10' },
}
const ITEM_STATUS: Record<string, string> = { novo: 'Novo', em_preparo: 'Em preparo', pronto: 'Pronto', servido: 'Servido', cancelado: 'Cancelado' }
const PAY_LABEL: Record<PayMethod, string> = { dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão', outro: 'Outro' }
const tabTitle = (c: BoardCard) =>
  `${c.tableName ?? 'Balcão'}${c.tabNumber ? ` — Comanda #${String(c.tabNumber).padStart(3, '0')}` : ''}${!c.tableName && c.tabLabel ? ` · ${c.tabLabel}` : ''}`

/** Painel lateral (folha) com foco no título, Esc fecha e devolve o foco para quem abriu. */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('h2')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[var(--z-sheet)] flex justify-end">
      <button type="button" aria-label="Fechar" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/30" />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto bg-surface shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-surface px-4 py-3">
          <h2 tabIndex={-1} className="text-lg font-bold text-ink outline-none">{title}</h2>
          <button type="button" onClick={onClose} className="pressable grid size-11 place-items-center rounded-full hover:bg-muted" aria-label="Fechar painel"><X aria-hidden="true" className="size-5" /></button>
        </div>
        <div className="flex flex-col gap-4 p-4">{children}</div>
      </div>
    </div>
  )
}

function OpenTabForm({ card, onOpened }: { card: BoardCard | null; onOpened: (tabId: string) => void }) {
  const { business: b } = useGestao()
  const toast = useToast()
  const qc = useQueryClient()
  const [people, setPeople] = useState('')
  const [label, setLabel] = useState('')
  const open = useMutation({
    mutationFn: () => openTab(b.id, card?.tableId ?? null, label, people ? Number(people) : null),
    onSuccess: (id) => { toast.success('Comanda aberta.'); void qc.invalidateQueries({ queryKey: ['gestao'] }); onOpened(id) },
    onError: (e) => toast.error(msg(e)),
  })
  const submit = (e: FormEvent) => { e.preventDefault(); open.mutate() }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">{card ? `${card.tableName}: disponível para atendimento.` : 'Comanda sem mesa (balcão, retirada no local).'}</p>
      <label className="text-sm font-medium text-ink">
        {card ? 'Identificação (opcional)' : 'Nome do cliente ou identificação'}
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} required={!card} className={`${field} mt-1`} />
      </label>
      <label className="text-sm font-medium text-ink">
        Pessoas (opcional)
        <input value={people} onChange={(e) => setPeople(e.target.value.replace(/\D/g, '').slice(0, 2))} inputMode="numeric" className={`${field} mt-1`} />
      </label>
      <button type="submit" disabled={open.isPending} className={primary}>{card ? 'Abrir mesa' : 'Abrir comanda'}</button>
    </form>
  )
}

function AddItems({ tabId }: { tabId: string }) {
  const { business: b } = useGestao()
  const toast = useToast()
  const qc = useQueryClient()
  const products = useQuery({ queryKey: ['merchant', 'products', b.id], queryFn: () => listProducts(b.id), staleTime: 60_000 })
  const [term, setTerm] = useState('')
  const [cart, setCart] = useState<Record<string, { qty: number; notes: string }>>({})
  const [op, setOp] = useState(newOpId)
  const list = (products.data ?? []).filter((p) => p.isAvailable && p.name.toLowerCase().includes(term.trim().toLowerCase()))
  const chosen = Object.entries(cart).filter(([, v]) => v.qty > 0)
  const byId = new Map((products.data ?? []).map((p) => [p.id, p]))
  const total = chosen.reduce((s, [id, v]) => s + (byId.get(id)?.priceCents ?? 0) * v.qty, 0)
  const bump = (id: string, d: number) => setCart((c) => ({ ...c, [id]: { qty: Math.max(0, Math.min(99, (c[id]?.qty ?? 0) + d)), notes: c[id]?.notes ?? '' } }))
  const send = useMutation({
    mutationFn: () => addTabItems(tabId, chosen.map(([productId, v]) => ({ productId, quantity: v.qty, notes: v.notes.trim() || undefined })), op),
    onSuccess: (n) => {
      toast.success(`${n} ${n === 1 ? 'item enviado' : 'itens enviados'} para a cozinha.`)
      setCart({}); setOp(newOpId())
      void qc.invalidateQueries({ queryKey: ['gestao'] })
    },
    onError: (e) => toast.error(msg(e)),
  })
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-line p-3" aria-labelledby={`add-${tabId}`}>
      <h3 id={`add-${tabId}`} className="text-sm font-semibold text-ink">Adicionar itens</h3>
      <label className="relative">
        <span className="sr-only">Buscar produto</span>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Buscar no cardápio" className={`${field} pl-9`} />
      </label>
      {products.isError ? <ErrorState error={products.error} onRetry={() => void products.refetch()} /> : (
        <ul className="flex max-h-64 flex-col divide-y divide-line overflow-y-auto">
          {list.length === 0 && <li className="py-2 text-sm text-ink-muted">{products.isLoading ? 'Carregando…' : 'Nenhum produto disponível.'}</li>}
          {list.map((p) => {
            const q = cart[p.id]?.qty ?? 0
            return (
              <li key={p.id} className="flex flex-col gap-1 py-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-sm text-ink">{p.name} <span className="text-ink-muted">· {formatBRL(p.priceCents)}</span></span>
                  <button type="button" onClick={() => bump(p.id, -1)} disabled={q === 0} className="pressable grid size-9 place-items-center rounded-full border border-line disabled:opacity-40" aria-label={`Diminuir ${p.name}`}><Minus aria-hidden="true" className="size-4" /></button>
                  <span className="w-6 text-center text-sm font-bold tabular-nums" aria-live="polite">{q}</span>
                  <button type="button" onClick={() => bump(p.id, 1)} className="pressable grid size-9 place-items-center rounded-full border border-line" aria-label={`Adicionar ${p.name}`}><Plus aria-hidden="true" className="size-4" /></button>
                </div>
                {q > 0 && (
                  <input
                    value={cart[p.id]?.notes ?? ''}
                    onChange={(e) => setCart((c) => ({ ...c, [p.id]: { qty: c[p.id]?.qty ?? 1, notes: e.target.value.slice(0, 200) } }))}
                    placeholder="Observação (ex.: sem cebola)"
                    aria-label={`Observação para ${p.name}`}
                    className="min-h-9 w-full rounded-lg border border-line bg-surface px-2 text-xs text-ink"
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
      <button type="button" disabled={chosen.length === 0 || send.isPending} onClick={() => send.mutate()} className={primary}>
        Enviar para a cozinha{chosen.length > 0 ? ` · ${formatBRL(total)}` : ''}
      </button>
    </section>
  )
}

function CloseTabForm({ card, onClosed }: { card: BoardCard; onClosed: () => void }) {
  const { business: b, can } = useGestao()
  const toast = useToast()
  const qc = useQueryClient()
  const cash = useQuery({ queryKey: ['gestao', 'cash-status', b.id], queryFn: () => getCashStatus(b.id) })
  const [discount, setDiscount] = useState('')
  const [rows, setRows] = useState<{ method: PayMethod; amount: string }[]>([{ method: 'pix', amount: '' }])
  const [op] = useState(newOpId)
  const discountCents = parseCents(discount) ?? 0
  const due = Math.max(0, card.totalCents - discountCents)
  const paid = rows.reduce((s, r) => s + (parseCents(r.amount) ?? 0), 0)
  const close = useMutation({
    mutationFn: () => closeTab(card.tabId!, rows.map((r) => ({ method: r.method, amountCents: parseCents(r.amount) ?? 0 })).filter((r) => r.amountCents > 0), discountCents, op),
    onSuccess: (r) => {
      toast.success(r.status === 'ja_fechada' ? 'Esta comanda já estava fechada.' : 'Comanda fechada e pagamento registrado no caixa.')
      void qc.invalidateQueries({ queryKey: ['gestao'] })
      onClosed()
    },
    onError: (e) => toast.error(msg(e)),
  })
  if (!can('cash.manage')) return <p className="rounded-xl bg-muted p-3 text-sm text-ink">O fechamento é feito por quem opera o caixa.</p>
  if (cash.data && !cash.data.open) return <p className="rounded-xl bg-muted p-3 text-sm text-ink">Abra o caixa (menu Caixa) para registrar o pagamento.</p>
  return (
    <form onSubmit={(e) => { e.preventDefault(); close.mutate() }} className="flex flex-col gap-3 rounded-xl border border-line p-3">
      <h3 className="text-sm font-semibold text-ink">Registrar pagamento e fechar</h3>
      <label className="text-sm font-medium text-ink">Desconto (R$)
        <input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" placeholder="0,00" className={`${field} mt-1`} />
      </label>
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <select aria-label={`Forma de pagamento ${i + 1}`} value={r.method} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, method: e.target.value as PayMethod } : y)))} className={`${field} w-36`}>
            {(Object.keys(PAY_LABEL) as PayMethod[]).map((m) => <option key={m} value={m}>{PAY_LABEL[m]}</option>)}
          </select>
          <input aria-label={`Valor ${i + 1}`} value={r.amount} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} inputMode="decimal" placeholder="0,00" className={field} />
          {rows.length > 1 && <button type="button" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className={ghost} aria-label="Remover forma de pagamento"><X aria-hidden="true" className="size-4" /></button>}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setRows((x) => [...x, { method: 'dinheiro', amount: '' }])} className={secondary}>Dividir pagamento</button>
        {rows.length === 1 && <button type="button" onClick={() => setRows([{ ...rows[0]!, amount: (due / 100).toFixed(2).replace('.', ',') }])} className={secondary}>Valor total</button>}
      </div>
      <p className="text-sm text-ink">A pagar: <strong>{formatBRL(due)}</strong> · Informado: <strong className={paid === due ? '' : 'text-danger'}>{formatBRL(paid)}</strong></p>
      <p className="text-xs text-ink-muted">Pagamentos presenciais são registrados manualmente (não há maquininha integrada). Nenhum documento fiscal é emitido.</p>
      <button type="submit" disabled={close.isPending || paid !== due || due === 0} className={primary}>Fechar comanda</button>
    </form>
  )
}

function TabDetail({ card, board, onClose }: { card: BoardCard; board: BoardCard[]; onClose: () => void }) {
  const { can } = useGestao()
  const toast = useToast()
  const qc = useQueryClient()
  const tabId = card.tabId!
  const items = useQuery({ queryKey: ['gestao', 'tab-items', tabId], queryFn: () => listTabItems(tabId), refetchInterval: 20_000 })
  const [transferTo, setTransferTo] = useState('')
  const refresh = () => void qc.invalidateQueries({ queryKey: ['gestao'] })
  const act = useMutation({
    mutationFn: async (a: { kind: 'status'; item: TabItem; to: 'em_preparo' | 'pronto' | 'servido' } | { kind: 'cancel'; item: TabItem } | { kind: 'transfer' } | { kind: 'request' } | { kind: 'cancelTab' }) => {
      if (a.kind === 'status') return setItemStatus(a.item.id, a.to)
      if (a.kind === 'cancel') {
        const r = window.prompt(`Motivo do cancelamento de ${a.item.name}:`)?.trim()
        if (!r) throw new Error('Informe o motivo.')
        return cancelTabItem(a.item.id, r)
      }
      if (a.kind === 'transfer') return transferTab(tabId, transferTo)
      if (a.kind === 'request') return requestClose(tabId)
      const r = window.prompt('Motivo do cancelamento da comanda:')?.trim()
      if (!r) throw new Error('Informe o motivo.')
      return cancelTab(tabId, r)
    },
    onSuccess: (_v, a) => {
      toast.success(a.kind === 'transfer' ? 'Comanda transferida.' : a.kind === 'request' ? 'Fechamento solicitado.' : a.kind === 'cancelTab' ? 'Comanda cancelada.' : 'Atualizado.')
      refresh()
      if (a.kind === 'cancelTab') onClose()
    },
    onError: (e) => { toast.error(msg(e)); refresh() },
  })
  const freeTables = board.filter((c) => c.tableId && c.situation === 'livre')
  const next: Record<string, 'em_preparo' | 'pronto' | 'servido' | undefined> = { novo: 'em_preparo', em_preparo: 'pronto', pronto: 'servido' }
  const nextLabel: Record<string, string> = { em_preparo: 'Iniciar', pronto: 'Pronto', servido: 'Servido' }
  const s = SITUATION[card.situation]
  return (
    <>
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl p-3 text-sm ${s.tint === 'bg-surface' ? 'bg-muted' : s.tint}`}>
        <span className="inline-flex items-center gap-1.5 font-semibold text-ink"><span className={`size-2.5 rounded-full ${s.dot}`} aria-hidden="true" />{s.label} — {s.hint}</span>
        {card.people && <span className="inline-flex items-center gap-1 text-ink-muted"><Users aria-hidden="true" className="size-4" />{card.people}</span>}
        {card.openedAt && <span className="inline-flex items-center gap-1 text-ink-muted"><Clock aria-hidden="true" className="size-4" />aberta há {since(card.openedAt)}</span>}
        {card.openedBy && <span className="text-ink-muted">por {card.openedBy.split(' ')[0]}</span>}
      </div>
      <section aria-labelledby={`itens-${tabId}`}>
        <h3 id={`itens-${tabId}`} className="mb-2 text-sm font-semibold text-ink">Itens · {formatBRL(card.totalCents)}</h3>
        {items.isError ? <ErrorState error={items.error} onRetry={() => void items.refetch()} /> : (items.data ?? []).length === 0 ? (
          <p className="text-sm text-ink-muted">{items.isLoading ? 'Carregando…' : 'Nenhum item ainda.'}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {(items.data ?? []).map((i) => (
              <li key={i.id} className={`flex items-start gap-2 py-2 text-sm ${i.status === 'cancelado' ? 'opacity-60' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className={`text-ink ${i.status === 'cancelado' ? 'line-through' : ''}`}><strong className="tabular-nums">{i.quantity}×</strong> {i.name} <span className="text-ink-muted">· {formatBRL(i.unitCents * i.quantity)}</span></p>
                  {i.notes && <p className="text-xs text-ink-muted">Obs.: {i.notes}</p>}
                  <p className="text-xs text-ink-muted">{ITEM_STATUS[i.status] ?? i.status}</p>
                </div>
                {next[i.status] && card.tabId && (
                  <button type="button" disabled={act.isPending} onClick={() => act.mutate({ kind: 'status', item: i, to: next[i.status]! })} className="pressable min-h-9 rounded-full border border-line px-3 text-xs font-semibold text-ink">{nextLabel[next[i.status]!]}</button>
                )}
                {i.status !== 'cancelado' && i.status !== 'servido' && (
                  <button type="button" disabled={act.isPending} onClick={() => act.mutate({ kind: 'cancel', item: i })} className="pressable min-h-9 rounded-full px-2 text-xs font-semibold text-danger hover:bg-muted">Cancelar</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {card.situation !== 'aguardando_pagamento' && <AddItems tabId={tabId} />}
      {card.tableId && freeTables.length > 0 && card.situation !== 'aguardando_pagamento' && (
        <div className="flex gap-2">
          <select aria-label="Transferir para a mesa" value={transferTo} onChange={(e) => setTransferTo(e.target.value)} className={field}>
            <option value="">Transferir para…</option>
            {freeTables.map((t) => <option key={t.tableId} value={t.tableId!}>{t.tableName}</option>)}
          </select>
          <button type="button" disabled={!transferTo || act.isPending} onClick={() => act.mutate({ kind: 'transfer' })} className={secondary}><ArrowRightLeft aria-hidden="true" className="size-4" />Transferir</button>
        </div>
      )}
      {card.situation !== 'aguardando_pagamento' && (
        <button type="button" disabled={act.isPending || card.itemsCount === 0} onClick={() => act.mutate({ kind: 'request' })} className={secondary}>Solicitar fechamento</button>
      )}
      <CloseTabForm card={card} onClosed={onClose} />
      {can('cash.manage') && (
        <button type="button" disabled={act.isPending} onClick={() => act.mutate({ kind: 'cancelTab' })} className="pressable min-h-11 self-start rounded-full px-3 text-sm font-semibold text-danger hover:bg-muted">Cancelar comanda</button>
      )}
    </>
  )
}

function TablesSetup({ onDone }: { onDone: () => void }) {
  const { business: b } = useGestao()
  const toast = useToast()
  const qc = useQueryClient()
  const tables = useQuery({ queryKey: ['gestao', 'tables', b.id], queryFn: () => listTables(b.id) })
  const [count, setCount] = useState('10')
  const [area, setArea] = useState('')
  const [cap, setCap] = useState('4')
  const [qr, setQr] = useState(false)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['gestao'] })
  const create = useMutation({
    mutationFn: () => createTables(b.id, Number(count), area, Number(cap) || 4),
    onSuccess: (n) => { toast.success(`${n} ${n === 1 ? 'mesa criada' : 'mesas criadas'}.`); refresh() },
    onError: (e) => toast.error(msg(e)),
  })
  const save = useMutation({
    mutationFn: (t: { id: string; name: string; area: string | null; capacity: number | null; active: boolean }) => saveTable(b.id, t.id, t.name, t.area ?? '', t.capacity, t.active),
    onSuccess: () => { toast.success('Mesa atualizada.'); refresh() },
    onError: (e) => toast.error(msg(e)),
  })
  const list = tables.data ?? []
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle
        title="Configurar mesas"
        subtitle="Crie as mesas, ajuste nomes e imprima o QR de cada uma."
        actions={<>
          {list.length > 0 && <button type="button" onClick={() => setQr(true)} className={secondary}><Printer aria-hidden="true" className="size-4" />QR das mesas</button>}
          <button type="button" onClick={onDone} className={primary}>Voltar ao quadro</button>
        </>}
      />
      <form onSubmit={(e) => { e.preventDefault(); create.mutate() }} className={`${box} grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end`}>
        <label className="text-sm font-medium text-ink">Quantidade<input value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" className={`${field} mt-1`} /></label>
        <label className="text-sm font-medium text-ink">Área (opcional)<input value={area} onChange={(e) => setArea(e.target.value)} maxLength={40} placeholder="Salão, Varanda…" className={`${field} mt-1`} /></label>
        <label className="text-sm font-medium text-ink">Lugares<input value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, '').slice(0, 2))} inputMode="numeric" className={`${field} mt-1`} /></label>
        <button type="submit" disabled={create.isPending || !Number(count)} className={primary}><Plus aria-hidden="true" className="size-4" />Criar mesas</button>
      </form>
      {tables.isError ? <ErrorState error={tables.error} onRetry={() => void tables.refetch()} /> : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((t) => (
            <li key={t.id} className={`flex flex-col gap-2 rounded-card border border-line bg-surface p-3 ${t.active ? '' : 'opacity-60'}`}>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const f = new FormData(e.currentTarget)
                  save.mutate({ id: t.id, name: String(f.get('name') ?? ''), area: String(f.get('area') ?? '') || null, capacity: Number(f.get('cap')) || null, active: t.active })
                }}
                className="grid grid-cols-3 gap-2"
              >
                <input name="name" defaultValue={t.name} aria-label="Nome da mesa" maxLength={40} className={`${field} col-span-3`} />
                <input name="area" defaultValue={t.area ?? ''} aria-label="Área" placeholder="Área" maxLength={40} className={`${field} col-span-2`} />
                <input name="cap" defaultValue={t.capacity ?? ''} aria-label="Lugares" inputMode="numeric" className={field} />
                <button type="submit" disabled={save.isPending} className={`${secondary} col-span-2`}>Salvar</button>
                <button type="button" disabled={save.isPending} onClick={() => save.mutate({ ...t, active: !t.active })} className={ghost}>{t.active ? 'Desativar' : 'Ativar'}</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {qr && <TableQrSheet tables={list.filter((t) => t.active)} businessName={b.name} onClose={() => setQr(false)} />}
    </div>
  )
}

/** Quadro de mesas e comandas (Premium). Situação calculada no banco; atualiza em tempo real. */
export function TablesTab() {
  const { business: b, niche, can } = useGestao()
  const q = useQuery({ queryKey: ['gestao', 'board', b.id], queryFn: () => getBoard(b.id), refetchInterval: 30_000 })
  const [filter, setFilter] = useState<'todas' | Situation>('todas')
  const [selected, setSelected] = useState<{ tableId: string | null; tabId: string | null } | null>(null)
  const [newCounter, setNewCounter] = useState(false)
  const [setup, setSetup] = useState(false)
  const board = useMemo(() => q.data ?? [], [q.data])
  const card = selected ? board.find((c) => (selected.tabId && c.tabId === selected.tabId) || (!selected.tabId && c.tableId === selected.tableId)) ?? null : null
  if (setup) return <TablesSetup onDone={() => setSetup(false)} />
  const tables = board.filter((c) => c.tableId)
  const counter = board.filter((c) => !c.tableId)
  const visible = (list: BoardCard[]) => (filter === 'todas' ? list : list.filter((c) => c.situation === filter))
  const count = (s: Situation) => board.filter((c) => c.situation === s).length
  const Card = ({ c }: { c: BoardCard }) => {
    const s = SITUATION[c.situation]
    return (
      <li>
        <button
          type="button"
          onClick={() => setSelected({ tableId: c.tableId, tabId: c.tabId })}
          className={`hover-lift pressable flex min-h-32 w-full flex-col gap-1 rounded-card border border-line p-3 text-left ${s.tint}`}
        >
          <span className="flex w-full items-start justify-between gap-2">
            <span className="min-w-0 truncate text-base font-bold text-ink">{c.tableName ?? c.tabLabel ?? 'Balcão'}</span>
            {c.capacity && <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-ink-muted"><Users aria-hidden="true" className="size-3" />{c.people ?? c.capacity}</span>}
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink"><span className={`size-2 rounded-full ${s.dot}`} aria-hidden="true" />{s.label}</span>
          <span className="text-xs text-ink-muted">{s.hint}</span>
          {c.tabId && (
            <span className="mt-auto flex w-full items-end justify-between gap-2 pt-1 text-xs text-ink-muted">
              <span>#{String(c.tabNumber).padStart(3, '0')}{c.openedAt ? ` · ${since(c.openedAt)}` : ''}</span>
              <strong className="text-sm tabular-nums text-ink">{formatBRL(c.totalCents)}</strong>
            </span>
          )}
        </button>
      </li>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle
        title={niche === 'restaurante' ? 'Comandas e mesas' : 'Comandas de balcão'}
        subtitle="Toque numa mesa para abrir, lançar itens, transferir ou fechar a conta."
        actions={<>
          <button type="button" onClick={() => setNewCounter(true)} className={secondary}><Plus aria-hidden="true" className="size-4" />Comanda de balcão</button>
          {can('settings.manage') && <button type="button" onClick={() => setSetup(true)} className={secondary}><Settings2 aria-hidden="true" className="size-4" />Configurar mesas</button>}
        </>}
      />
      <div role="group" aria-label="Filtrar por situação" className="flex gap-2 overflow-x-auto pb-1">
        <button type="button" aria-pressed={filter === 'todas'} onClick={() => setFilter('todas')} className={`${filter === 'todas' ? primary : secondary} shrink-0`}>Todas ({board.length})</button>
        {(Object.keys(SITUATION) as Situation[]).map((k) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={`${filter === k ? primary : secondary} shrink-0`}>
            <span className={`size-2 rounded-full ${SITUATION[k].dot}`} aria-hidden="true" />{SITUATION[k].label} ({count(k)})
          </button>
        ))}
      </div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isLoading ? (
        <p role="status" className="text-sm text-ink-muted">Carregando…</p>
      ) : board.length === 0 ? (
        <EmptyState
          icon={UtensilsCrossed}
          title="Nenhuma mesa cadastrada"
          description={can('settings.manage') ? 'Crie as mesas do salão para começar. Comandas de balcão funcionam sem mesa.' : 'O responsável pelo estabelecimento ainda não cadastrou as mesas.'}
          action={can('settings.manage') ? <button type="button" onClick={() => setSetup(true)} className={primary}>Configurar mesas</button> : undefined}
        />
      ) : (
        <>
          {tables.length > 0 && (
            <ul aria-label="Mesas" className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
              {visible(tables).map((c) => <Card key={c.tableId} c={c} />)}
            </ul>
          )}
          {counter.length > 0 && (
            <section aria-labelledby="balcao" className="flex flex-col gap-2">
              <h2 id="balcao" className="text-base font-semibold text-ink">Balcão</h2>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                {visible(counter).map((c) => <Card key={c.tabId} c={c} />)}
              </ul>
            </section>
          )}
        </>
      )}
      {newCounter && (
        <Sheet title="Nova comanda de balcão" onClose={() => setNewCounter(false)}>
          <OpenTabForm card={null} onOpened={(id) => { setNewCounter(false); setSelected({ tableId: null, tabId: id }) }} />
        </Sheet>
      )}
      {selected && card && (
        <Sheet title={card.tabId ? tabTitle(card) : card.tableName ?? 'Mesa'} onClose={() => setSelected(null)}>
          {card.tabId ? (
            <TabDetail card={card} board={board} onClose={() => setSelected(null)} />
          ) : (
            <OpenTabForm card={card} onOpened={(id) => setSelected({ tableId: card.tableId, tabId: id })} />
          )}
        </Sheet>
      )}
    </div>
  )
}
