import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, BarChart3, Briefcase, CreditCard, Clock, ExternalLink, LayoutGrid, PiggyBank, Plus, Receipt, ReceiptText, Star, Store, Trash2, Wallet } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useParams } from 'react-router-dom'
import { businessHref } from '../../components/cards/BusinessCard.tsx'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { Page, PageHeader } from '../../components/nav/PageHeader.tsx'
import { useAuth } from '../../features/auth/AuthProvider.tsx'
import { useCategories } from '../../features/catalog/hooks.ts'
import type { CategoryKind } from '../../features/catalog/schemas.ts'
import {
  addHour,
  createCategory,
  createProduct,
  deleteCategory,
  deleteProduct,
  getBusiness,
  listCategories,
  listHours,
  listMyBusinesses,
  listProducts,
  productFormSchema,
  removeHour,
  setProductAvailability,
  storeFormSchema,
  updateCategory,
  updateProduct,
  updateStore,
  type MerchantBusiness,
  type MerchantProduct,
  type ProductForm,
  type StoreForm,
} from '../../features/merchant/repository.ts'
import { CashTab, ExpensesTab, ProfitTab } from './MerchantFinance.tsx'
import { canInBusiness, type BusinessPermission } from '../../features/permissions/permissions.ts'
import { formatBRL } from '../../lib/money.ts'
import { JobsTab, OrdersTab, PlanTab, ReviewsTab, SalesTab } from './OperationsTabs.tsx'

const field = 'min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink'
const primary = 'pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-brand px-4 text-sm font-semibold text-surface disabled:opacity-50'
const secondary = 'pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold text-ink disabled:opacity-50'
const box = 'rounded-card border border-line bg-surface p-4 md:p-6'
const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const STATUS_TEXT = { pending: 'Em análise — você já pode preparar a loja; ela só fica pública após a aprovação.', active: 'Publicado na Tucaí.', suspended: 'Suspenso pela Tucaí.', rejected: 'Solicitação recusada.' } as const
const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Algo deu errado. Tente novamente.')
const centsText = (c: number) => (c ? formatBRL(c).replace('R$ ', '') : '')

function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-ink">{children}</label>
}
function FieldError({ text }: { text?: string }) {
  return text ? <p role="alert" className="mt-1 text-xs text-danger">{text}</p> : null
}

// ---------- Loja ----------
function StoreTab({ b }: { b: MerchantBusiness }) {
  const qc = useQueryClient()
  const toast = useToast()
  const categories = useCategories(b.businessType as CategoryKind)
  const [v, setV] = useState<StoreForm>({
    description: b.description ?? '',
    phone: b.phone ?? '',
    whatsapp: b.whatsapp ?? '',
    addressLine: b.addressLine ?? '',
    coverUrl: b.coverUrl ?? '',
    logoUrl: b.logoUrl ?? '',
    categoryId: b.categoryId ?? '',
    deliveryOffer: b.deliveryOffer,
    ownDeliveryFee: centsText(b.ownDeliveryFeeCents),
    acceptsPickup: b.acceptsPickup,
    minOrder: centsText(b.minOrderCents),
    estimatedMin: b.estimatedMinMinutes?.toString() ?? '',
    estimatedMax: b.estimatedMaxMinutes?.toString() ?? '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = <K extends keyof StoreForm>(k: K, val: StoreForm[K]) => setV((p) => ({ ...p, [k]: val }))
  const save = useMutation({
    mutationFn: () => updateStore(b.id, v),
    onSuccess: () => {
      toast.success('Loja atualizada.')
      void qc.invalidateQueries({ queryKey: ['merchant'] })
      void qc.invalidateQueries({ queryKey: ['store'] })
    },
    onError: (e) => toast.error(msg(e)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const parsed = storeFormSchema.safeParse(v)
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])))
    setErrors({})
    save.mutate()
  }
  const text = (k: keyof StoreForm, label: string, props: Record<string, unknown> = {}) => (
    <div>
      <Label htmlFor={`st-${k}`}>{label}</Label>
      <input id={`st-${k}`} value={v[k] as string} onChange={(e) => set(k, e.target.value as never)} aria-invalid={!!errors[k]} className={field} {...props} />
      <FieldError text={errors[k]} />
    </div>
  )
  return (
    <form onSubmit={submit} noValidate className={`${box} grid grid-cols-1 gap-4 md:grid-cols-2`}>
      <div className="md:col-span-2">
        <Label htmlFor="st-description">Descrição</Label>
        <textarea id="st-description" maxLength={1000} value={v.description} onChange={(e) => set('description', e.target.value)} className={`${field} min-h-24 py-2`} />
        <FieldError text={errors.description} />
      </div>
      <div>
        <Label htmlFor="st-categoryId">Categoria</Label>
        <select id="st-categoryId" value={v.categoryId} onChange={(e) => set('categoryId', e.target.value)} className={field}>
          <option value="">Sem categoria</option>
          {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
      {text('addressLine', 'Endereço', { maxLength: 200, autoComplete: 'street-address' })}
      {text('phone', 'Telefone', { type: 'tel' })}
      {text('whatsapp', 'WhatsApp', { type: 'tel' })}
      {text('logoUrl', 'Logotipo (endereço https da imagem)', { inputMode: 'url' })}
      {text('coverUrl', 'Capa (endereço https da imagem)', { inputMode: 'url' })}
      {b.businessType !== 'servico' && (
        <fieldset className="flex flex-col gap-3 md:col-span-2">
          <legend className="mb-1 text-sm font-medium text-ink">Entrega e retirada</legend>
          <div className="flex flex-wrap gap-2">
            {([['partner', 'Entregadores Tucaí'], ['own', 'Entrega própria'], ['none', 'Sem entrega']] as const).map(([val, label]) => (
              <label key={val} className={`pressable inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm ${v.deliveryOffer === val ? 'border-brand font-semibold text-brand' : 'border-line text-ink'}`}>
                <input type="radio" name="st-delivery" className="sr-only" checked={v.deliveryOffer === val} onChange={() => set('deliveryOffer', val)} />
                {label}
              </label>
            ))}
          </div>
          {v.deliveryOffer === 'partner' && (
            <p className="text-xs text-ink-muted">O cliente paga R$ 4,00 de entrega e você contribui com R$ 2,00; o entregador parceiro recebe R$ 5,00 e a Tucaí R$ 1,00. Ao marcar o pedido como pronto, ele é oferecido aos entregadores disponíveis da sua cidade.</p>
          )}
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
            <input type="checkbox" className="size-5" checked={v.acceptsPickup} onChange={(e) => set('acceptsPickup', e.target.checked)} />
            Aceita retirada no local
          </label>
          <FieldError text={errors.acceptsPickup} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            {v.deliveryOffer === 'own' && text('ownDeliveryFee', 'Taxa de entrega (R$)', { inputMode: 'decimal', placeholder: '0,00' })}
            {text('minOrder', 'Pedido mínimo (R$)', { inputMode: 'decimal', placeholder: '0,00' })}
            {text('estimatedMin', 'Tempo mín. (min)', { inputMode: 'numeric' })}
            {text('estimatedMax', 'Tempo máx. (min)', { inputMode: 'numeric' })}
          </div>
        </fieldset>
      )}
      <div className="md:col-span-2">
        <button type="submit" disabled={save.isPending} className={primary}>{save.isPending ? 'Salvando…' : 'Salvar loja'}</button>
      </div>
    </form>
  )
}

// ---------- Horários ----------
function HoursTab({ b }: { b: MerchantBusiness }) {
  const qc = useQueryClient()
  const toast = useToast()
  const hours = useQuery({ queryKey: ['merchant', 'hours', b.id], queryFn: () => listHours(b.id) })
  const [weekday, setWeekday] = useState(1)
  const [opens, setOpens] = useState('18:00')
  const [closes, setCloses] = useState('23:00')
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['merchant', 'hours', b.id] })
    void qc.invalidateQueries({ queryKey: ['catalog', 'hours', b.id] })
  }
  const add = useMutation({ mutationFn: () => addHour(b.id, { weekday, opens, closes }), onSuccess: refresh, onError: (e) => toast.error(msg(e)) })
  const remove = useMutation({ mutationFn: removeHour, onSuccess: refresh, onError: (e) => toast.error(msg(e)) })
  return (
    <div className={`${box} flex flex-col gap-4`}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          add.mutate()
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <div>
          <Label htmlFor="h-day">Dia</Label>
          <select id="h-day" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className={field}>
            {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </div>
        <div><Label htmlFor="h-open">Abre</Label><input id="h-open" type="time" required value={opens} onChange={(e) => setOpens(e.target.value)} className={field} /></div>
        <div><Label htmlFor="h-close">Fecha</Label><input id="h-close" type="time" required value={closes} onChange={(e) => setCloses(e.target.value)} className={field} /></div>
        <button type="submit" disabled={add.isPending} className={primary}><Plus aria-hidden="true" className="size-4" />Adicionar</button>
      </form>
      <p className="text-xs text-ink-muted">Fechamento antes da abertura atravessa a meia-noite (ex.: 18:00–02:00). Horário de Brasília.</p>
      {hours.isError ? (
        <ErrorState error={hours.error} onRetry={() => void hours.refetch()} />
      ) : (hours.data ?? []).length === 0 ? (
        <p className="text-sm text-ink-muted">{hours.isLoading ? 'Carregando…' : 'Nenhum horário cadastrado: a loja aparece como fechada.'}</p>
      ) : (
        <ul className="divide-y divide-line">
          {(hours.data ?? []).map((h) => (
            <li key={h.id} className="flex min-h-11 items-center justify-between gap-2 text-sm">
              <span className="text-ink">{WEEKDAYS[h.weekday]} · {h.opens}–{h.closes}</span>
              <button type="button" aria-label={`Remover ${WEEKDAYS[h.weekday]} ${h.opens}–${h.closes}`} onClick={() => remove.mutate(h.id)} className="pressable inline-flex size-11 items-center justify-center rounded-full text-danger">
                <Trash2 aria-hidden="true" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------- Cardápio ----------
const emptyProduct = (categoryId: string): ProductForm => ({ categoryId, name: '', description: '', price: '', imageUrl: '', isAvailable: true })

function ProductEditor({ businessId, categories, product, onDone }: { businessId: string; categories: { id: string; name: string }[]; product: MerchantProduct | null; onDone: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [v, setV] = useState<ProductForm>(
    product
      ? { categoryId: product.categoryId, name: product.name, description: product.description ?? '', price: formatBRL(product.priceCents).replace('R$ ', ''), imageUrl: product.imageUrl ?? '', isAvailable: product.isAvailable }
      : emptyProduct(categories[0]?.id ?? ''),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const save = useMutation({
    mutationFn: () => (product ? updateProduct(product.id, v) : createProduct(businessId, v)),
    onSuccess: () => {
      toast.success(product ? 'Produto atualizado.' : 'Produto cadastrado.')
      void qc.invalidateQueries({ queryKey: ['merchant', 'products', businessId] })
      void qc.invalidateQueries({ queryKey: ['store'] })
      onDone()
    },
    onError: (e) => toast.error(msg(e)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const parsed = productFormSchema.safeParse(v)
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])))
    setErrors({})
    save.mutate()
  }
  const set = <K extends keyof ProductForm>(k: K, val: ProductForm[K]) => setV((p) => ({ ...p, [k]: val }))
  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-3 rounded-xl border border-line p-3 md:grid-cols-2">
      <div><Label htmlFor="p-name">Nome</Label><input id="p-name" value={v.name} maxLength={120} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name} className={field} /><FieldError text={errors.name} /></div>
      <div><Label htmlFor="p-price">Preço (R$)</Label><input id="p-price" inputMode="decimal" placeholder="24,90" value={v.price} onChange={(e) => set('price', e.target.value)} aria-invalid={!!errors.price} className={field} /><FieldError text={errors.price} /></div>
      <div>
        <Label htmlFor="p-cat">Categoria</Label>
        <select id="p-cat" value={v.categoryId} onChange={(e) => set('categoryId', e.target.value)} className={field}>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <FieldError text={errors.categoryId} />
      </div>
      <div><Label htmlFor="p-img">Foto (endereço https)</Label><input id="p-img" inputMode="url" value={v.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} className={field} /><FieldError text={errors.imageUrl} /></div>
      <div className="md:col-span-2"><Label htmlFor="p-desc">Descrição</Label><textarea id="p-desc" maxLength={500} value={v.description} onChange={(e) => set('description', e.target.value)} className={`${field} min-h-20 py-2`} /></div>
      <label className="flex min-h-11 items-center gap-2 text-sm text-ink"><input type="checkbox" className="size-5" checked={v.isAvailable} onChange={(e) => set('isAvailable', e.target.checked)} />Disponível</label>
      <div className="flex gap-2 md:col-span-2">
        <button type="submit" disabled={save.isPending} className={primary}>{save.isPending ? 'Salvando…' : 'Salvar'}</button>
        <button type="button" onClick={onDone} className={secondary}>Cancelar</button>
      </div>
    </form>
  )
}

function MenuTab({ b }: { b: MerchantBusiness }) {
  const qc = useQueryClient()
  const toast = useToast()
  const cats = useQuery({ queryKey: ['merchant', 'categories', b.id], queryFn: () => listCategories(b.id) })
  const products = useQuery({ queryKey: ['merchant', 'products', b.id], queryFn: () => listProducts(b.id) })
  const [newCat, setNewCat] = useState('')
  const [editing, setEditing] = useState<MerchantProduct | 'new' | null>(null)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['merchant'] })
    void qc.invalidateQueries({ queryKey: ['store'] })
  }
  const addCat = useMutation({ mutationFn: () => createCategory(b.id, newCat, (cats.data?.length ?? 0) * 10), onSuccess: () => { setNewCat(''); refresh() }, onError: (e) => toast.error(msg(e)) })
  const toggleCat = useMutation({ mutationFn: (c: { id: string; isActive: boolean }) => updateCategory(c.id, { isActive: !c.isActive }), onSuccess: refresh, onError: (e) => toast.error(msg(e)) })
  const delCat = useMutation({ mutationFn: deleteCategory, onSuccess: refresh, onError: (e) => toast.error(msg(e)) })
  const avail = useMutation({ mutationFn: (p: MerchantProduct) => setProductAvailability(p.id, !p.isAvailable), onSuccess: refresh, onError: (e) => toast.error(msg(e)) })
  const delProd = useMutation({ mutationFn: deleteProduct, onSuccess: refresh, onError: (e) => toast.error(msg(e)) })

  if (cats.isError) return <ErrorState error={cats.error} onRetry={() => void cats.refetch()} />
  if (products.isError) return <ErrorState error={products.error} onRetry={() => void products.refetch()} />
  const categories = cats.data ?? []
  return (
    <div className="flex flex-col gap-4">
      <form
        className={`${box} flex flex-wrap items-end gap-3`}
        onSubmit={(e) => {
          e.preventDefault()
          if (newCat.trim()) addCat.mutate()
        }}
      >
        <div className="min-w-0 flex-1"><Label htmlFor="c-new">Nova categoria do cardápio</Label><input id="c-new" maxLength={80} value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Ex.: Lanches" className={field} /></div>
        <button type="submit" disabled={addCat.isPending || !newCat.trim()} className={primary}><Plus aria-hidden="true" className="size-4" />Criar</button>
      </form>
      {categories.length === 0 ? (
        <EmptyState icon={LayoutGrid} title="Cardápio vazio" description="Crie uma categoria e depois cadastre os produtos." />
      ) : (
        <>
          {editing ? (
            <ProductEditor businessId={b.id} categories={categories} product={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
          ) : (
            <button type="button" onClick={() => setEditing('new')} className={`${primary} w-fit`}><Plus aria-hidden="true" className="size-4" />Novo produto</button>
          )}
          {categories.map((c) => {
            const items = (products.data ?? []).filter((p) => p.categoryId === c.id)
            return (
              <section key={c.id} aria-labelledby={`mc-${c.id}`} className={box}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 id={`mc-${c.id}`} className="text-base font-semibold text-ink">{c.name}{!c.isActive && <span className="ml-2 text-xs font-normal text-ink-muted">(oculta)</span>}</h3>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => toggleCat.mutate(c)} className={secondary}>{c.isActive ? 'Ocultar' : 'Mostrar'}</button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Excluir a categoria "${c.name}" e os ${items.length} produtos dela?`)) delCat.mutate(c.id)
                      }}
                      className={secondary}
                      aria-label={`Excluir categoria ${c.name}`}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </button>
                  </div>
                </div>
                {items.length === 0 ? (
                  <p className="text-sm text-ink-muted">Sem produtos.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {items.map((p) => (
                      <li key={p.id} className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-center">
                        <span className="min-w-0 flex-1">
                          <span className="font-semibold text-ink">{p.name}</span> · {formatBRL(p.priceCents)}
                          {!p.isAvailable && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-ink-muted">Indisponível</span>}
                        </span>
                        <span className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => avail.mutate(p)} className={secondary}>{p.isAvailable ? 'Marcar indisponível' : 'Disponibilizar'}</button>
                        <button type="button" onClick={() => setEditing(p)} className={secondary}>Editar</button>
                        <button
                          type="button"
                          aria-label={`Excluir ${p.name}`}
                          onClick={() => {
                            if (window.confirm(`Excluir "${p.name}"?`)) delProd.mutate(p.id)
                          }}
                          className={secondary}
                        >
                          <Trash2 aria-hidden="true" className="size-4" />
                        </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </>
      )}
    </div>
  )
}

// ---------- estrutura ----------
const TABS: { to: string; label: string; icon: typeof Store; permission: BusinessPermission }[] = [
  { to: '', label: 'Loja', icon: Store, permission: 'store.customize' },
  { to: 'horarios', label: 'Horários', icon: Clock, permission: 'store.customize' },
  { to: 'cardapio', label: 'Cardápio', icon: LayoutGrid, permission: 'menu.manage' },
  { to: 'pedidos', label: 'Pedidos recebidos', icon: ReceiptText, permission: 'orders.view' },
  { to: 'vendas', label: 'Vendas', icon: BarChart3, permission: 'reports.view' },
  { to: 'caixa', label: 'Caixa', icon: Wallet, permission: 'reports.view' },
  { to: 'gastos', label: 'Gastos', icon: Receipt, permission: 'reports.view' },
  { to: 'lucro', label: 'Meu lucro', icon: PiggyBank, permission: 'reports.view' },
  { to: 'avaliacoes', label: 'Avaliações', icon: Star, permission: 'store.customize' },
  { to: 'vagas', label: 'Vagas', icon: Briefcase, permission: 'jobs.manage' },
  { to: 'plano', label: 'Plano', icon: CreditCard, permission: 'reports.view' },
]

function BusinessPanel() {
  const { businessId = '' } = useParams()
  const { authz } = useAuth()
  const q = useQuery({ queryKey: ['merchant', 'business', businessId], queryFn: () => getBusiness(businessId), enabled: !!businessId })
  if (q.isLoading) return <Page><p role="status" className="text-sm text-ink-muted">Carregando…</p></Page>
  if (q.isError) return <Page><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Page>
  const b = q.data
  if (!b) return <Page><EmptyState icon={Store} title="Estabelecimento não encontrado" description="Você não faz parte da equipe deste estabelecimento." /></Page>
  const allowed = (p: BusinessPermission) => canInBusiness(authz, p, b.id) || (p === 'store.customize' && canInBusiness(authz, 'settings.manage', b.id))
  const tabs = TABS.filter((t) => allowed(t.permission))
  const guard = (perm: BusinessPermission, el: ReactNode) => (allowed(perm) ? el : <EmptyState title="Sem permissão" description="Seu cargo não permite alterar esta área." />)
  return (
    <Page>
      <Link to="/painel" className="pressable inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-ink"><ArrowLeft aria-hidden="true" className="size-4" />Meus estabelecimentos</Link>
      <PageHeader
        icon={Store}
        title={b.name}
        subtitle={STATUS_TEXT[b.status]}
        actions={b.status === 'active' ? <Link to={businessHref(b)} className={secondary}><ExternalLink aria-hidden="true" className="size-4" />Ver página</Link> : undefined}
      />
      {b.reviewNote && (b.status === 'rejected' || b.status === 'suspended') && <p role="alert" className="rounded-card border border-danger p-3 text-sm text-ink">Motivo informado pela Tucaí: {b.reviewNote}</p>}
      <nav aria-label="Áreas do painel" className="flex gap-2 overflow-x-auto">
        {tabs.map((t) => (
          <NavLink key={t.label} to={`/painel/${b.id}${t.to ? `/${t.to}` : ''}`} end className={({ isActive }) => `pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold ${isActive ? 'bg-brand text-surface' : 'border border-line text-ink'}`}>
            <t.icon aria-hidden="true" className="size-4" />
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={allowed('store.customize') ? <StoreTab key={b.id} b={b} /> : allowed('orders.view') ? <Navigate to="pedidos" replace /> : guard('store.customize', null)} />
        <Route path="horarios" element={guard('store.customize', <HoursTab b={b} />)} />
        <Route path="cardapio" element={guard('menu.manage', <MenuTab b={b} />)} />
        <Route path="pedidos" element={guard('orders.view', <OrdersTab businessId={b.id} canUpdate={allowed('orders.update_status')} kitchen={authz?.memberships.find((m) => m.businessId === b.id)?.role === 'kitchen'} />)} />
        <Route path="vendas" element={guard('reports.view', <SalesTab businessId={b.id} />)} />
        <Route path="caixa" element={guard('reports.view', <CashTab businessId={b.id} />)} />
        <Route path="gastos" element={guard('reports.view', <ExpensesTab businessId={b.id} />)} />
        <Route path="lucro" element={guard('reports.view', <ProfitTab businessId={b.id} />)} />
        <Route path="avaliacoes" element={guard('store.customize', <ReviewsTab businessId={b.id} />)} />
        <Route path="plano" element={guard('reports.view', <PlanTab businessId={b.id} />)} />
        <Route path="vagas" element={guard('jobs.manage', <JobsTab businessId={b.id} active={b.status === 'active'} />)} />
        <Route path="*" element={<Navigate to="" replace />} />
      </Routes>
      {b.status === 'active' && (
        <p className="text-sm text-ink">
          Publique novidades e ofertas ligadas ao cardápio no <Link to="/conectuai" className="font-semibold text-brand underline">Conectuaí</Link> escolhendo “Publicar como {b.name}”.
        </p>
      )}
    </Page>
  )
}

function BusinessList() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const q = useQuery({ queryKey: ['merchant', 'list', userId], queryFn: () => listMyBusinesses(userId), enabled: !!userId })
  return (
    <Page>
      <PageHeader icon={Store} title="Meus estabelecimentos" subtitle="Painel exclusivo de cada negócio." />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState
          icon={Store}
          title={q.isLoading ? 'Carregando…' : 'Você ainda não faz parte de nenhum estabelecimento'}
          action={<Link to="/cadastrar-negocio" className="pressable inline-flex min-h-11 items-center rounded-full bg-orange px-5 text-sm font-semibold text-ink">Cadastrar meu negócio</Link>}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(q.data ?? []).map((b) => (
            <li key={b.id}>
              <Link to={`/painel/${b.id}`} className="hover-lift pressable flex flex-col gap-1 rounded-card border border-line bg-surface p-4">
                <span className="font-semibold text-ink">{b.name}</span>
                <span className="text-sm text-ink-muted">{STATUS_TEXT[b.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}

/** Painel do comerciante. A interface esconde o que o cargo não permite; a RLS decide de fato. */
export function MerchantPanel() {
  return (
    <Routes>
      <Route index element={<BusinessList />} />
      <Route path=":businessId/*" element={<BusinessPanel />} />
    </Routes>
  )
}
