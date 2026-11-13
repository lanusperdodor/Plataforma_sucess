import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LayoutGrid, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { AddressFields } from '../../components/forms/AddressFields.tsx'
import { emptyAddress, validateAddress, type AddressErrors, type AddressParts } from '../../features/address/address.ts'
import { getBusinessAddress, saveBusinessAddress } from '../../features/address/repository.ts'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { useCategories } from '../../features/catalog/hooks.ts'
import type { CategoryKind } from '../../features/catalog/schemas.ts'
import {
  addHour,
  createCategory,
  createProduct,
  deleteCategory,
  deleteProduct,
  listCategories,
  listHours,
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
import { formatBRL } from '../../lib/money.ts'

const field = 'min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink'
const primary = 'pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-brand px-4 text-sm font-semibold text-surface disabled:opacity-50'
const secondary = 'pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold text-ink disabled:opacity-50'
const box = 'rounded-card border border-line bg-surface p-4 md:p-6'
const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
export const STATUS_TEXT = { pending: 'Em análise — você já pode preparar a loja; ela só fica pública após a aprovação.', active: 'Publicado na Tucaí.', suspended: 'Suspenso pela Tucaí.', rejected: 'Solicitação recusada.' } as const
const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Algo deu errado. Tente novamente.')
const centsText = (c: number) => (c ? formatBRL(c).replace('R$ ', '') : '')

function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-ink">{children}</label>
}
function FieldError({ text }: { text?: string }) {
  return text ? <p role="alert" className="mt-1 text-xs text-danger">{text}</p> : null
}

// ---------- Loja ----------
export function StoreTab({ b }: { b: MerchantBusiness }) {
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
  // endereço em partes (0042); começa vazio se a loja ainda não preencheu
  const addrQ = useQuery({ queryKey: ['merchant', 'address', b.id], queryFn: () => getBusinessAddress(b.id) })
  const [addr, setAddr] = useState<AddressParts>(emptyAddress())
  const [addrTouched, setAddrTouched] = useState(false)
  const [addrErrors, setAddrErrors] = useState<AddressErrors>({})
  useEffect(() => { if (addrQ.data && !addrTouched) setAddr(addrQ.data) }, [addrQ.data, addrTouched])
  const changeAddr = (a: AddressParts) => { setAddrTouched(true); setAddr(a) }
  const set = <K extends keyof StoreForm>(k: K, val: StoreForm[K]) => setV((p) => ({ ...p, [k]: val }))
  const save = useMutation({
    mutationFn: async () => {
      await updateStore(b.id, v)
      if (addrTouched) await saveBusinessAddress(b.id, addr)
    },
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
    const ae = addrTouched ? validateAddress(addr) : {}
    setAddrErrors(ae)
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])))
    setErrors({})
    if (Object.keys(ae).length > 0) return toast.error('Confira o endereço da loja.')
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
      <div className="flex flex-col gap-2 md:col-span-2">
        <p className="text-sm font-medium text-ink">Endereço da loja</p>
        {!addrQ.data && b.addressLine && <p className="text-xs text-ink-muted">Endereço atual: {b.addressLine}. Preencha os campos abaixo para atualizar.</p>}
        <AddressFields idPrefix="st-end" value={addr} onChange={changeAddr} errors={addrErrors} />
      </div>
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
            <p className="text-xs text-ink-muted">O frete depende da distância por ruas: o cliente paga de R$ 4,00 a R$ 5,00 e sua loja contribui com até R$ 2,00; o entregador parceiro recebe de R$ 5,00 a R$ 7,00 e a Tucaí R$ 1,00. O pedido é oferecido aos entregadores disponíveis da sua cidade.</p>
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
export function HoursTab({ b }: { b: MerchantBusiness }) {
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

export function MenuTab({ b }: { b: MerchantBusiness }) {
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
