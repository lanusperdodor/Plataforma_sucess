import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, Maximize2, Minimize2, Store, Wallet } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AccountMenu } from '../../components/account/AccountMenu.tsx'
import { ThemeToggleButton } from '../../components/account/ThemeToggle.tsx'
import { businessHref } from '../../components/cards/BusinessCard.tsx'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { BRAND } from '../../config/brand.ts'
import { useAuth } from '../../features/auth/AuthProvider.tsx'
import { useCategories } from '../../features/catalog/hooks.ts'
import type { CategoryKind } from '../../features/catalog/schemas.ts'
import { getBusinessPlan, getCashStatus, listMemberExtras } from '../../features/gestao/repository.ts'
import { getBusiness, listMyBusinesses, type MerchantBusiness } from '../../features/merchant/repository.ts'
import { canInBusiness, type BusinessPermission } from '../../features/permissions/permissions.ts'
import { LIVE_NOTIFICATION_EVENT } from '../../features/realtime/LiveUpdates.tsx'
import type { LiveNotification } from '../../features/realtime/repository.ts'
import { setActiveContext } from '../../lib/activeContext.ts'
import { ExpensesTab, ProfitTab } from '../merchant/MerchantFinance.tsx'
import { HoursTab, MenuTab, STATUS_TEXT, StoreTab } from '../merchant/MerchantPanel.tsx'
import { JobsTab, OrdersTab, ReviewsTab, SalesTab } from '../merchant/OperationsTabs.tsx'
import { AdsTab } from './AdsTab.tsx'
import { CashRegisterTab } from './CashRegisterTab.tsx'
import { GestaoContext, useGestao, type GestaoCtx } from './context.ts'
import { CostingPanel } from './CostingPanel.tsx'
import { KitchenTab } from './KitchenTab.tsx'
import { gestaoNav, NICHE_LABEL, nicheOf } from './nav.ts'
import { OverviewTab } from './OverviewTab.tsx'
import { ReportsTab } from './ReportsTab.tsx'
import { SettingsTab } from './SettingsTab.tsx'
import { TablesTab } from './TablesTab.tsx'
import { TeamTab } from './TeamTab.tsx'
import { PremiumBadge, PremiumUpsell } from './ui.tsx'

/** API de tela cheia (opcional; nem todo navegador oferece, ex.: iPhone). */
function useFullscreen() {
  const supported = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen
  const [on, setOn] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement)
  useEffect(() => {
    const f = () => setOn(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', f)
    return () => document.removeEventListener('fullscreenchange', f)
  }, [])
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void document.documentElement.requestFullscreen().catch(() => undefined)
  }
  return { supported, on, toggle }
}

/** Aviso discreto de pedido novo (canto superior direito), substitui o aviso padrão enquanto o Gestão está aberto. */
function NewOrderToast() {
  const [items, setItems] = useState<LiveNotification[]>([])
  const navigate = useNavigate()
  useEffect(() => {
    const on = (e: Event) => {
      const n = (e as CustomEvent<LiveNotification>).detail
      if (n?.kind !== 'order_new') return
      e.preventDefault()
      setItems((list) => [n, ...list.filter((x) => x.id !== n.id)].slice(0, 3))
      globalThis.setTimeout(() => setItems((list) => list.filter((x) => x.id !== n.id)), 15000)
    }
    window.addEventListener(LIVE_NOTIFICATION_EVENT, on)
    return () => window.removeEventListener(LIVE_NOTIFICATION_EVENT, on)
  }, [])
  if (items.length === 0) return null
  const close = (id: string) => setItems((list) => list.filter((x) => x.id !== id))
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-3 top-3 z-[var(--z-toast)] flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-2">
      {items.map((n) => (
        <div key={n.id} role="status" className="pointer-events-auto rounded-2xl border border-line bg-surface p-3 shadow-[var(--shadow-card)]">
          <p className="text-sm font-bold text-ink">Novo pedido recebido!</p>
          <p className="mt-0.5 text-sm text-ink-muted">{(n.message ?? '').replace(/^Novo pedido\s*/i, 'Pedido ')}</p>
          <div className="mt-2 flex justify-end gap-1">
            <button type="button" onClick={() => close(n.id)} className="pressable min-h-9 rounded-full px-3 text-sm font-semibold text-ink-muted hover:bg-muted">Fechar</button>
            <button type="button" onClick={() => { close(n.id); navigate(n.link ?? '/painel') }} className="pressable min-h-9 rounded-full bg-brand px-3 text-sm font-semibold text-surface">Ver pedido</button>
          </div>
        </div>
      ))}
    </div>
  )
}

function CashChip({ businessId }: { businessId: string }) {
  const q = useQuery({ queryKey: ['gestao', 'cash-status', businessId], queryFn: () => getCashStatus(businessId), refetchInterval: 60_000 })
  if (!q.data) return null
  return (
    <Link
      to={`/painel/${businessId}/caixa`}
      className="pressable hidden min-h-9 items-center gap-1.5 rounded-full bg-muted px-3 text-xs font-semibold text-ink sm:inline-flex"
      title={q.data.open ? `Aberto por ${q.data.opened_by ?? 'equipe'}` : 'Caixa fechado'}
    >
      <Wallet aria-hidden="true" className="size-3.5" />
      <span className={`size-2 rounded-full ${q.data.open ? 'bg-success' : 'bg-ink-muted'}`} aria-hidden="true" />
      Caixa {q.data.open ? 'aberto' : 'fechado'}
    </Link>
  )
}

function BusinessSwitcher({ current }: { current: MerchantBusiness }) {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const navigate = useNavigate()
  const location = useLocation()
  const q = useQuery({ queryKey: ['merchant', 'list', userId], queryFn: () => listMyBusinesses(userId), enabled: !!userId })
  const list = q.data ?? []
  if (list.length < 2) return null
  const section = location.pathname.split('/').slice(3).join('/')
  return (
    <label className="hidden items-center lg:flex">
      <span className="sr-only">Trocar de estabelecimento</span>
      <select
        value={current.id}
        onChange={(e) => {
          setActiveContext({ kind: 'loja', businessId: e.target.value })
          navigate(`/painel/${e.target.value}${section ? `/${section}` : ''}`)
        }}
        className="min-h-9 max-w-48 rounded-full border border-line bg-surface px-3 text-xs font-semibold text-ink"
      >
        {list.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </label>
  )
}

function GestaoHeader() {
  const { business: b, niche, plan, can } = useGestao()
  const fs = useFullscreen()
  const nav = gestaoNav(niche).filter((i) => can(i.permission))
  const navRef = useRef<HTMLElement>(null)
  const location = useLocation()
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [location.pathname])
  return (
    <header className="sticky top-0 z-[var(--z-nav)] border-b border-line bg-surface">
      <div className="mx-auto flex min-h-14 max-w-[96rem] items-center gap-2 px-3 md:gap-3 md:px-4">
        <Link to="/painel" className="inline-flex min-h-11 shrink-0 items-center gap-2" aria-label="Tucaí Gestão — meus estabelecimentos">
          <img src={BRAND.assets.icon} alt="" width={28} height={28} className="size-7 rounded-lg" />
          <span className="hidden text-sm font-bold text-ink sm:inline">Tucaí <span className="font-medium text-ink-muted">Gestão</span></span>
        </Link>
        <span aria-hidden="true" className="hidden h-6 w-px bg-line sm:block" />
        <div className="flex min-w-0 items-center gap-2">
          {b.logoUrl ? (
            <img src={b.logoUrl} alt="" width={32} height={32} className="size-8 shrink-0 rounded-lg object-cover" />
          ) : (
            <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-ink"><Store className="size-4" /></span>
          )}
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-bold text-ink">{b.name}</p>
            <p className="truncate text-xs text-ink-muted">
              {NICHE_LABEL[niche]}
              {plan?.name ? <> · Plano {plan.name}{plan.source === 'homologacao' ? ' (homologação)' : ''}</> : ' · Sem plano ativo'}
            </p>
          </div>
        </div>
        <BusinessSwitcher current={b} />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <CashChip businessId={b.id} />
          {fs.supported && (
            <button type="button" onClick={fs.toggle} className="pressable hidden size-11 place-items-center rounded-full text-ink hover:bg-muted md:grid" aria-label={fs.on ? 'Sair da tela cheia' : 'Tela cheia'} title={fs.on ? 'Sair da tela cheia' : 'Tela cheia'}>
              {fs.on ? <Minimize2 aria-hidden="true" className="size-5" /> : <Maximize2 aria-hidden="true" className="size-5" />}
            </button>
          )}
          <ThemeToggleButton />
          <AccountMenu compact />
          <Link to="/" className="pressable inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm font-semibold text-ink hover:bg-muted md:px-3">
            <ArrowLeft aria-hidden="true" className="size-4" />
            <span className="hidden md:inline">Voltar à Tucaí</span>
            <span className="sr-only md:hidden">Voltar à Tucaí</span>
          </Link>
        </div>
      </div>
      <nav ref={navRef} aria-label="Módulos do Tucaí Gestão" className="mx-auto flex max-w-[96rem] gap-1 overflow-x-auto px-2 md:px-3 [scrollbar-width:thin]">
        {nav.map((i) => (
          <NavLink
            key={`${i.to}-${i.label}`}
            to={`/painel/${b.id}${i.to ? `/${i.to}` : ''}`}
            end
            className={({ isActive }) =>
              `relative inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-t-lg px-3 text-sm outline-offset-[-2px] transition-colors hover:bg-muted ${
                isActive ? 'font-semibold text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-ink' : 'font-medium text-ink-muted'
              }`
            }
          >
            <i.icon aria-hidden="true" className="size-4" />
            {i.label}
            {i.premium && <PremiumBadge />}
          </NavLink>
        ))}
      </nav>
    </header>
  )
}

function Section({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-[96rem] min-w-0 flex-col gap-4 p-3 md:gap-6 md:p-6">{children}</div>
}

function GestaoRoutes() {
  const { business: b, premium, can } = useGestao()
  const { authz } = useAuth()
  const deny = <EmptyState title="Sem permissão" description="Seu cargo não permite acessar esta área." />
  const guard = (perm: BusinessPermission, el: ReactNode) => (can(perm) ? el : deny)
  const prem = (perm: BusinessPermission, feature: string, el: ReactNode) => guard(perm, premium ? el : <PremiumUpsell businessId={b.id} feature={feature} />)
  const role = authz?.memberships.find((m) => m.businessId === b.id)?.role
  return (
    <Routes>
      <Route index element={can('reports.view') ? <OverviewTab /> : can('tabs.manage') && premium ? <Navigate to="mesas" replace /> : <Navigate to="pedidos" replace />} />
      <Route path="loja" element={guard('store.customize', <StoreTab key={b.id} b={b} />)} />
      <Route path="horarios" element={guard('store.customize', <HoursTab b={b} />)} />
      <Route path="cardapio" element={guard('menu.manage', <MenuTab b={b} />)} />
      <Route path="pedidos" element={guard('orders.view', <OrdersTab businessId={b.id} canUpdate={can('orders.update_status')} kitchen={role === 'kitchen'} />)} />
      <Route path="cozinha" element={guard('orders.view', <KitchenTab />)} />
      <Route path="mesas/*" element={prem('tabs.manage', 'Comandas e mesas', <TablesTab />)} />
      <Route path="caixa" element={prem('cash.manage', 'Caixa presencial', <CashRegisterTab />)} />
      <Route path="vendas" element={guard('reports.view', <SalesTab businessId={b.id} />)} />
      <Route path="gastos" element={prem('reports.view', 'Controle de gastos', <ExpensesTab businessId={b.id} />)} />
      <Route path="lucro" element={prem('reports.view', 'Meu lucro', <><ProfitTab businessId={b.id} /><CostingPanel /></>)} />
      <Route path="anuncios" element={guard('store.customize', <AdsTab />)} />
      <Route path="equipe" element={guard('staff.manage', <TeamTab />)} />
      <Route path="relatorios" element={guard('reports.view', <ReportsTab />)} />
      <Route path="avaliacoes" element={guard('store.customize', <ReviewsTab businessId={b.id} />)} />
      <Route path="vagas" element={guard('jobs.manage', <JobsTab businessId={b.id} active={b.status === 'active'} />)} />
      <Route path="configuracoes" element={guard('reports.view', <SettingsTab />)} />
      <Route path="plano" element={<Navigate to="../configuracoes" replace />} />
      <Route path="*" element={<Navigate to={`/painel/${b.id}`} replace />} />
    </Routes>
  )
}

function GestaoFrame({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh flex-col bg-muted">{children}</div>
}

function GestaoBusiness() {
  const { businessId = '' } = useParams()
  const { authz } = useAuth()
  const q = useQuery({ queryKey: ['merchant', 'business', businessId], queryFn: () => getBusiness(businessId), enabled: !!businessId })
  const plan = useQuery({ queryKey: ['gestao', 'plan', businessId], queryFn: () => getBusinessPlan(businessId), enabled: !!q.data })
  const extras = useQuery({ queryKey: ['gestao', 'extras', businessId, authz?.userId], queryFn: () => listMemberExtras(businessId), enabled: !!q.data })
  const categories = useCategories(q.data?.businessType as CategoryKind | undefined)
  const ctx = useMemo<GestaoCtx | null>(() => {
    const b = q.data
    if (!b) return null
    const mine = (extras.data ?? []).filter((x) => x.userId === authz?.userId).map((x) => x.permission)
    const can = (p: BusinessPermission) => canInBusiness(authz, p, b.id, mine) || (p === 'store.customize' && canInBusiness(authz, 'settings.manage', b.id))
    const cat = (categories.data ?? []).find((c) => c.id === b.categoryId)
    const categoryName = cat ? `${cat.label} ${cat.slug}` : null
    return { business: b, niche: nicheOf(b.businessType, categoryName), plan: plan.data, premium: !!plan.data?.premium, can }
  }, [q.data, plan.data, extras.data, categories.data, authz])

  useEffect(() => {
    if (q.data) document.title = `${q.data.name} · Tucaí Gestão`
  }, [q.data])

  if (q.isLoading) return <GestaoFrame><p role="status" className="p-6 text-sm text-ink-muted">Carregando Tucaí Gestão…</p></GestaoFrame>
  if (q.isError) return <GestaoFrame><Section><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Section></GestaoFrame>
  if (!ctx) {
    return (
      <GestaoFrame>
        <Section>
          <EmptyState icon={Store} title="Estabelecimento não encontrado" description="Você não faz parte da equipe deste estabelecimento." action={<Link to="/painel" className="text-sm font-semibold text-brand underline">Meus estabelecimentos</Link>} />
        </Section>
      </GestaoFrame>
    )
  }
  const b = ctx.business
  return (
    <GestaoContext.Provider value={ctx}>
      <GestaoFrame>
        <a href="#gestao-conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[var(--z-toast)] focus:rounded-full focus:bg-surface focus:px-4 focus:py-2">Pular para o conteúdo</a>
        <GestaoHeader />
        <main id="gestao-conteudo" className="flex-1">
          <Section>
            {b.status !== 'active' && (
              <p role="status" className="rounded-card border border-line bg-surface p-3 text-sm text-ink">
                {STATUS_TEXT[b.status]}
                {b.reviewNote && (b.status === 'rejected' || b.status === 'suspended') && <> Motivo informado pela Tucaí: {b.reviewNote}</>}
              </p>
            )}
            <GestaoRoutes />
            {b.status === 'active' && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                <Link to={businessHref(b)} className="inline-flex items-center gap-1 font-semibold text-ink underline"><ExternalLink aria-hidden="true" className="size-3.5" />Ver página pública</Link>
                <span>Publique novidades no <Link to="/conectuai" className="font-semibold text-ink underline">Conectuaí</Link> como “{b.name}”.</span>
              </p>
            )}
          </Section>
        </main>
        <NewOrderToast />
      </GestaoFrame>
    </GestaoContext.Provider>
  )
}

function BusinessList() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const q = useQuery({ queryKey: ['merchant', 'list', userId], queryFn: () => listMyBusinesses(userId), enabled: !!userId })
  const list = q.data ?? []
  if (list.length === 1) return <Navigate to={`/painel/${list[0]!.id}`} replace />
  return (
    <GestaoFrame>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex min-h-14 max-w-5xl items-center gap-2 px-4">
          <img src={BRAND.assets.icon} alt="" width={28} height={28} className="size-7 rounded-lg" />
          <span className="text-sm font-bold text-ink">Tucaí <span className="font-medium text-ink-muted">Gestão</span></span>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggleButton />
            <AccountMenu compact />
            <Link to="/" className="pressable inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-semibold text-ink hover:bg-muted"><ArrowLeft aria-hidden="true" className="size-4" />Voltar à Tucaí</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
        <h1 className="text-2xl font-bold text-ink">Meus estabelecimentos</h1>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={Store}
            title={q.isLoading ? 'Carregando…' : 'Você ainda não faz parte de nenhum estabelecimento'}
            action={q.isLoading ? undefined : <Link to="/cadastrar-negocio" className="pressable inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-sm font-semibold text-surface">Cadastrar meu negócio</Link>}
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {list.map((b) => (
              <li key={b.id}>
                <Link to={`/painel/${b.id}`} onClick={() => setActiveContext({ kind: 'loja', businessId: b.id })} className="hover-lift pressable flex flex-col gap-1 rounded-card border border-line bg-surface p-4">
                  <span className="font-semibold text-ink">{b.name}</span>
                  <span className="text-sm text-ink-muted">{STATUS_TEXT[b.status]}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </GestaoFrame>
  )
}

/**
 * Tucaí Gestão: layout próprio em tela cheia (rota de nível superior, fora do marketplace),
 * sem barra lateral, cabeçalho ou navegação inferior da Tucaí. Funciona com URL direta e recarga.
 */
export function GestaoApp() {
  return (
    <Routes>
      <Route index element={<BusinessList />} />
      <Route path=":businessId/*" element={<GestaoBusiness />} />
    </Routes>
  )
}

