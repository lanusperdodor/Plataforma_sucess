import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bike, CircleCheck, CircleX, Clock, MapPin, MessageCircle, Phone, ShoppingBag, Star, Store, Utensils } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { deliveryText, timeText } from '../components/cards/BusinessCard.tsx'
import { EmptyState } from '../components/feedback/EmptyState.tsx'
import { ErrorState } from '../components/feedback/ErrorState.tsx'
import { Img } from '../components/feedback/Img.tsx'
import { NotFoundState } from '../components/feedback/NotFoundState.tsx'
import { Skeleton } from '../components/feedback/Skeleton.tsx'
import { Page } from '../components/nav/PageHeader.tsx'
import { useBusinessHours, useCategories } from '../features/catalog/hooks.ts'
import type { BusinessHour, BusinessSummary } from '../features/catalog/schemas.ts'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import { getProfileByUser, isFollowingBusiness, setBusinessFollow } from '../features/conecta/repository.ts'
import { addRecent } from '../features/recent/recentStore.ts'
import { trackViewItem } from '../features/tracking/tracker.ts'
import { Feed } from './ConectaPage.tsx'
import { getMenu, getPublicBusiness, getReviews, type MenuProduct } from '../features/store/repository.ts'
import { ProductSheet } from './store/ProductSheet.tsx'
import { formatBRL } from '../lib/money.ts'

const WEEKDAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' })

/** Só dígitos; links de WhatsApp/telefone nunca recebem texto livre. */
export function phoneDigits(raw: string | null): string | null {
  const d = (raw ?? '').replace(/\D/g, '')
  return d.length >= 8 ? d : null
}

export function whatsappHref(raw: string | null): string | null {
  const d = phoneDigits(raw)
  if (!d) return null
  return `https://wa.me/${d.startsWith('55') ? d : `55${d}`}`
}

function Hours({ hours }: { hours: BusinessHour[] }) {
  if (hours.length === 0) return <p className="text-sm text-ink-muted">Horários não informados.</p>
  return (
    <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
      {WEEKDAY_NAMES.map((name, day) => {
        const windows = hours.filter((h) => h.weekday === day)
        return (
          <li key={day} className="flex justify-between gap-3">
            <span className="text-ink-muted">{name}</span>
            <span className="text-ink">{windows.length ? windows.map((w) => `${w.opens}–${w.closes}`).join(', ') : 'Fechado'}</span>
          </li>
        )
      })}
    </ul>
  )
}

/** O estabelecimento recebe pedidos pela Tucaí? (produtos com entrega ou retirada ativas) */
export function acceptsOrders(b: BusinessSummary): boolean {
  return b.businessType !== 'servico' && (b.deliveryOffer !== 'none' || b.acceptsPickup)
}

function ProductRow({ p, onAdd }: { p: MenuProduct; onAdd?: () => void }) {
  return (
    <li id={`produto-${p.id}`} className="flex gap-3 rounded-card border border-line bg-surface p-3 target:ring-2 target:ring-orange">
      <div className="min-w-0 flex-1">
        <h4 className="font-semibold text-ink">{p.name}</h4>
        {p.description && <p className="mt-0.5 line-clamp-3 text-sm text-ink-muted">{p.description}</p>}
        {p.groups.length > 0 && (
          <p className="mt-1 text-xs text-ink-muted">
            {p.groups.map((g) => `${g.name}: ${g.options.filter((o) => o.isAvailable).map((o) => (o.priceDeltaCents ? `${o.name} (+${formatBRL(o.priceDeltaCents)})` : o.name)).join(', ') || 'indisponível'}`).join(' · ')}
          </p>
        )}
        <p className="mt-2 flex items-center gap-2 text-sm">
          <span className={`font-bold ${p.isAvailable ? 'text-ink' : 'text-ink-muted line-through'}`}>{formatBRL(p.priceCents)}</span>
          {!p.isAvailable && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-ink-muted">Indisponível</span>}
        </p>
        {onAdd && p.isAvailable && (
          <button type="button" onClick={onAdd} aria-label={`Adicionar ${p.name}`} className="pressable mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-orange px-4 text-sm font-semibold text-ink">
            <ShoppingBag aria-hidden="true" className="size-4" />Adicionar
          </button>
        )}
      </div>
      {p.imageUrl && <Img src={p.imageUrl} alt="" width={96} height={96} className="size-24 shrink-0 rounded-xl object-cover" />}
    </li>
  )
}

function Header({ b, categoryLabel }: { b: BusinessSummary; categoryLabel?: string }) {
  const Fallback = b.businessType === 'restaurante' ? Utensils : Store
  const wa = whatsappHref(b.whatsapp)
  const tel = phoneDigits(b.phone)
  const time = timeText(b.estimatedMinMinutes, b.estimatedMaxMinutes)
  return (
    <header className="overflow-hidden rounded-card border border-line bg-surface">
      <div className={`w-full bg-muted ${b.coverUrl ? 'aspect-[3/1]' : 'h-20 md:h-28'}`}>
        {b.coverUrl ? <Img src={b.coverUrl} alt="" width={1200} height={400} priority className="h-full w-full object-cover" /> : null}
      </div>
      <div className="flex flex-col gap-3 p-4 md:p-6">
        <div className="flex items-end gap-3">
          <div className="-mt-14 shrink-0 rounded-2xl border-4 border-surface bg-surface">
            {b.logoUrl ? (
              <Img src={b.logoUrl} alt="" width={80} height={80} className="size-20 rounded-xl object-cover" />
            ) : (
              <div aria-hidden="true" className="grid size-20 place-items-center rounded-xl bg-brand text-orange"><Fallback className="size-8" /></div>
            )}
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-tight text-ink md:text-3xl">{b.name}</h1>
            {categoryLabel && <p className="text-sm text-ink-muted">{categoryLabel}</p>}
          </div>
        </div>
        {b.description && <p className="max-w-prose text-sm text-ink">{b.description}</p>}
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
          <li className={`inline-flex items-center gap-1 font-semibold ${b.isOpen ? 'text-success' : ''}`}>
            {b.isOpen ? <CircleCheck aria-hidden="true" className="size-4" /> : <CircleX aria-hidden="true" className="size-4" />}
            {b.isOpen ? 'Aberto agora' : 'Fechado agora'}
          </li>
          <li className="inline-flex items-center gap-1">
            <Star aria-hidden="true" className="size-4 text-warm" />
            {b.ratingCount > 0 ? `${b.ratingAvg.toFixed(1).replace('.', ',')} (${b.ratingCount} ${b.ratingCount === 1 ? 'avaliação' : 'avaliações'})` : 'Sem avaliações ainda'}
          </li>
          {b.businessType !== 'servico' && <li className="inline-flex items-center gap-1"><Bike aria-hidden="true" className="size-4" />{deliveryText(b)}{b.acceptsPickup && b.deliveryOffer !== 'none' ? ' · retirada' : ''}</li>}
          {time && <li className="inline-flex items-center gap-1"><Clock aria-hidden="true" className="size-4" />{time}</li>}
          {b.minOrderCents > 0 && <li>Pedido mínimo {formatBRL(b.minOrderCents)}</li>}
          {b.addressLine && <li className="inline-flex items-center gap-1"><MapPin aria-hidden="true" className="size-4" />{b.addressLine}</li>}
        </ul>
        {(wa || tel) && (
          <div className="flex flex-wrap gap-2">
            {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="pressable inline-flex min-h-11 items-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-surface"><MessageCircle aria-hidden="true" className="size-4" />WhatsApp</a>}
            {tel && <a href={`tel:${tel}`} className="pressable inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-ink"><Phone aria-hidden="true" className="size-4" />Ligar</a>}
          </div>
        )}
      </div>
    </header>
  )
}

function FollowBusiness({ businessId }: { businessId: string }) {
  const { session } = useAuth()
  const me = session?.user.id
  const qc = useQueryClient()
  const profile = useQuery({ queryKey: ['conecta', 'me', me ?? ''], queryFn: () => getProfileByUser(me!), enabled: !!me })
  const following = useQuery({ queryKey: ['conecta', 'bizfollow', me ?? '', businessId], queryFn: () => isFollowingBusiness(me!, businessId), enabled: !!me && !!profile.data })
  const m = useMutation({ mutationFn: () => setBusinessFollow(me!, businessId, !following.data), onSuccess: () => void qc.invalidateQueries({ queryKey: ['conecta', 'bizfollow'] }) })
  if (!me) return <Link to="/entrar" className="pressable inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold text-ink">Entre para seguir</Link>
  if (profile.data === null) return <Link to="/conectuai" className="pressable inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold text-ink">Crie seu perfil no Conectuaí para seguir</Link>
  return (
    <button type="button" disabled={m.isPending || following.isLoading} onClick={() => m.mutate()} className={`pressable inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ${following.data ? 'border border-line text-ink' : 'bg-orange text-ink'}`}>
      {following.data ? 'Seguindo' : 'Seguir no Conectuaí'}
    </button>
  )
}

/** Página pública do estabelecimento (restaurante, loja ou serviço), com dados reais. */
export function BusinessPage() {
  const { slug = '' } = useParams()
  const { session } = useAuth()
  const business = useQuery({ queryKey: ['store', 'business', slug], queryFn: () => getPublicBusiness(slug), enabled: !!slug })
  const b = business.data ?? undefined
  const categories = useCategories()
  const hours = useBusinessHours(b?.id)
  const menu = useQuery({ queryKey: ['store', 'menu', b?.id ?? ''], queryFn: () => getMenu(b!.id), enabled: !!b })
  const reviews = useQuery({ queryKey: ['store', 'reviews', b?.id ?? ''], queryFn: () => getReviews(b!.id), enabled: !!b })
  const [selected, setSelected] = useState<MenuProduct | null>(null)

  useEffect(() => {
    if (!b) return
    addRecent({ kind: b.businessType, id: b.id, slug: b.slug, name: b.name, imageUrl: b.logoUrl ?? b.coverUrl ?? undefined })
    trackViewItem({ id: b.id, name: b.name, category: b.businessType })
  }, [b])

  if (business.isLoading) {
    return <Page><Skeleton className="aspect-[3/1] w-full" /><Skeleton className="h-24 w-full" /></Page>
  }
  if (business.isError) return <Page><ErrorState error={business.error} onRetry={() => void business.refetch()} /></Page>
  if (!b) {
    return (
      <Page>
        <NotFoundState title="Estabelecimento não encontrado" description="Ele pode não estar ativo na Tucaí ou o endereço está incorreto." />
      </Page>
    )
  }
  const categoryLabel = categories.data?.find((c) => c.id === b.categoryId)?.label
  const listLabel = b.businessType === 'servico' ? 'Serviços' : b.businessType === 'loja' ? 'Produtos' : 'Cardápio'
  const orderable = acceptsOrders(b)

  return (
    <Page>
      <Header b={b} categoryLabel={categoryLabel} />
      <div><FollowBusiness businessId={b.id} /></div>
      <p role="note" className="flex items-start gap-2 rounded-card border border-line bg-muted p-3 text-sm text-ink">
        <ShoppingBag aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {b.businessType === 'servico'
          ? 'Para contratar, fale direto com o prestador pelos contatos acima.'
          : !orderable
            ? 'Este estabelecimento ainda não ativou entrega nem retirada pela Tucaí. Fale direto pelos contatos acima.'
            : b.isOpen
              ? 'Peça pela Tucaí e pague na entrega ou na retirada: dinheiro, Pix ou cartão na maquininha.'
              : 'Fechado agora. Você pode montar a sacola e confirmar o pedido quando o estabelecimento abrir.'}
      </p>
      <section aria-labelledby="loja-menu" className="flex flex-col gap-4">
        <h2 id="loja-menu" className="text-xl font-semibold text-ink">{listLabel}</h2>
        {menu.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : menu.isError ? (
          <ErrorState error={menu.error} onRetry={() => void menu.refetch()} />
        ) : (menu.data ?? []).length === 0 ? (
          <EmptyState title={`${listLabel} ainda não publicado`} description="O estabelecimento ainda não cadastrou itens." />
        ) : (
          (menu.data ?? []).map((s) => (
            <section key={s.id} aria-labelledby={`sec-${s.id}`}>
              <h3 id={`sec-${s.id}`} className="mb-2 text-base font-semibold text-ink">{s.name}</h3>
              <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">{s.products.map((p) => <ProductRow key={p.id} p={p} onAdd={orderable ? () => setSelected(p) : undefined} />)}</ul>
            </section>
          ))
        )}
      </section>
      <section aria-labelledby="loja-horarios" className="rounded-card border border-line bg-surface p-4">
        <h2 id="loja-horarios" className="mb-2 text-lg font-semibold text-ink">Horários</h2>
        {hours.isError ? <ErrorState error={hours.error} onRetry={() => void hours.refetch()} /> : <Hours hours={hours.data ?? []} />}
      </section>
      <section aria-labelledby="loja-avaliacoes" className="flex flex-col gap-2">
        <h2 id="loja-avaliacoes" className="text-lg font-semibold text-ink">Avaliações</h2>
        {(reviews.data ?? []).length === 0 ? (
          <p className="text-sm text-ink-muted">{reviews.isLoading ? 'Carregando…' : 'Ainda sem avaliações. Só quem recebe um pedido feito pela Tucaí pode avaliar.'}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(reviews.data ?? []).map((r) => (
              <li key={r.id} className="rounded-card border border-line bg-surface p-3 text-sm">
                <p className="font-semibold text-ink">{'★'.repeat(r.rating)}<span className="sr-only">{r.rating} de 5</span> · {r.authorName ?? 'Cliente'}</p>
                {r.comment && <p className="text-ink">{r.comment}</p>}
                <p className="text-xs text-ink-muted">{dateFmt.format(new Date(r.createdAt))} · pedido verificado</p>
                {r.reply && <p className="mt-2 border-l-2 border-brand pl-2 text-ink"><span className="font-semibold">Resposta do estabelecimento:</span> {r.reply}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="loja-conecta" className="flex flex-col gap-3">
        <h2 id="loja-conecta" className="text-lg font-semibold text-ink">No Conectuaí</h2>
        <Feed scope={{ kind: 'business', businessId: b.id }} me={session?.user.id ?? null} empty={{ title: 'Sem publicações ainda', description: 'Novidades e ofertas do estabelecimento aparecem aqui.' }} />
      </section>
      {selected && <ProductSheet product={selected} business={{ id: b.id, slug: b.slug, name: b.name }} onClose={() => setSelected(null)} />}
      <Link to={b.businessType === 'restaurante' ? '/restaurantes' : b.businessType === 'loja' ? '/lojas' : '/servicos'} className="text-sm font-semibold text-brand underline">
        Ver outros {b.businessType === 'restaurante' ? 'restaurantes' : b.businessType === 'loja' ? 'lojas' : 'serviços'}
      </Link>
    </Page>
  )
}
