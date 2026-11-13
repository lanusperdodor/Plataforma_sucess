import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, CalendarClock, CheckCircle2, Clock, Hourglass, MapPin, Navigation, Package, Phone, PiggyBank, Power, Truck, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { EmptyState } from '../../components/feedback/EmptyState.tsx'
import { ErrorState } from '../../components/feedback/ErrorState.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { Page, PageHeader } from '../../components/nav/PageHeader.tsx'
import { useAuth } from '../../features/auth/AuthProvider.tsx'
import {
  VEHICLE_LABEL,
  acceptDelivery,
  declineOffer,
  shareLocation,
  finishDelivery,
  verifyDeliveryCode,
  getEarnings,
  getMyCourier,
  listOffers,
  myDeliveries,
  pickupDelivery,
  releaseDelivery,
  setOnline,
  type CourierDelivery,
  type CourierEarnings,
  WITHDRAWAL_LABEL,
  cancelWithdrawal,
  listWithdrawals,
  requestWithdrawal,
} from '../../features/courier/repository.ts'
import { PAYMENT_LABEL, STATUS_LABEL } from '../../features/orders/repository.ts'
import { ownDeliveries, ownDeliveryStatus, type OwnDelivery } from '../../features/courier/repository.ts'
import { formatBRL } from '../../lib/money.ts'
import { phoneDigits } from '../BusinessPage.tsx'
import { LiveLocation } from './LiveLocation.tsx'
import { googleMapsRoute } from '../../features/rastreamento/geo.ts'

const box = 'rounded-card border border-line bg-surface p-4 md:p-6'
const primary = 'pressable inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-orange px-5 text-base font-semibold text-ink disabled:opacity-50'
/** Tempo restante da rodada de oferta (atualiza a cada segundo). */
function OfferDeadline({ expiresAt, round }: { expiresAt: string | null; round: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = globalThis.setInterval(() => setNow(Date.now()), 1000)
    return () => globalThis.clearInterval(t)
  }, [])
  if (!expiresAt) return null
  const left = Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000))
  const mm = Math.floor(left / 60)
  const ss = String(left % 60).padStart(2, '0')
  return <p className="text-xs text-ink-muted">{left > 0 ? `Responda em ${mm}:${ss}` : 'Prazo encerrado, aguardando redistribuição'}{round > 1 ? ` · ${round}ª rodada` : ''}</p>
}

const secondary = 'pressable inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-ink disabled:opacity-50'
const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Algo deu errado. Tente novamente.')

const PREP_LABEL: Record<string, string> = {
  placed: 'Aguardando a loja aceitar', accepted: 'Pedido aceito pela loja', preparing: 'Em preparo', ready: 'Pronto para coleta',
}

function ActiveDelivery({ d }: { d: CourierDelivery }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [code, setCode] = useState('')
  const refresh = () => void qc.invalidateQueries({ queryKey: ['courier'] })
  const pickup = useMutation({ mutationFn: () => pickupDelivery(d.orderId), onSuccess: () => { toast.success('Coleta confirmada.'); refresh() }, onError: (e) => toast.error(msg(e)) })
  const release = useMutation({ mutationFn: () => releaseDelivery(d.orderId), onSuccess: () => { toast.success('Entrega liberada para outro entregador.'); refresh() }, onError: (e) => toast.error(msg(e)) })
  const [verified, setVerified] = useState(false)
  const [codeMsg, setCodeMsg] = useState<string | null>(null)
  // um identificador por entrega: tocar duas vezes em finalizar não conclui duas vezes
  const [opId] = useState(() => globalThis.crypto.randomUUID())
  const verify = useMutation({
    mutationFn: () => verifyDeliveryCode(d.orderId, code),
    onSuccess: (r) => {
      setCode('')
      if (r.ok) { setVerified(true); setCodeMsg(null); return }
      setCodeMsg(r.reason === 'bloqueado'
        ? `Muitas tentativas. Aguarde${r.lockedUntil && new Date(r.lockedUntil).getFullYear() < 2100 ? ` até ${new Date(r.lockedUntil).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ' o suporte da Tucaí'} para tentar de novo.`
        : 'Código inválido. Confira com o cliente.')
    },
    onError: (e) => toast.error(msg(e)),
  })
  const finish = useMutation({
    mutationFn: () => finishDelivery(d.orderId, opId),
    onSuccess: () => { toast.success(`Entrega concluída! +${formatBRL(d.payCents)}`); refresh() },
    onError: (e) => toast.error(msg(e)),
  })
  const tel = phoneDigits(d.customerPhone)
  const bizTel = phoneDigits(d.businessPhone)
  return (
    <section aria-labelledby={`ad-${d.orderId}`} className={`${box} flex flex-col gap-3`}>
      <h2 id={`ad-${d.orderId}`} className="text-lg font-semibold text-ink">Entrega em andamento · #{d.code}</h2>
      <p className="text-sm font-semibold text-success">Você recebe {formatBRL(d.payCents)}</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className={`rounded-xl border p-3 ${d.status === 'accepted' ? 'border-brand' : 'border-line'}`}>
          <p className="flex items-center gap-2 text-sm font-semibold text-ink"><Package aria-hidden="true" className="size-4" />1. Coletar em {d.businessName}</p>
          {d.businessAddress && <a href={googleMapsRoute(null, d.businessAddress) ?? undefined} target="_blank" rel="noopener noreferrer" className="text-sm text-brand underline">{d.businessAddress}</a>}
          {bizTel && <a href={`tel:${bizTel}`} className="mt-1 flex items-center gap-1 text-sm text-ink"><Phone aria-hidden="true" className="size-4" />Ligar para a loja</a>}
        </div>
        <div className={`rounded-xl border p-3 ${d.status === 'picked_up' ? 'border-brand' : 'border-line'}`}>
          <p className="flex items-center gap-2 text-sm font-semibold text-ink"><MapPin aria-hidden="true" className="size-4" />2. Entregar para {d.customerName ?? 'o cliente'}</p>
          {!d.customerName && <p className="text-sm text-ink-muted">Endereço e contato aparecem quando o estabelecimento aceitar o pedido.</p>}
          {d.address && <a href={googleMapsRoute(null, d.address) ?? undefined} target="_blank" rel="noopener noreferrer" className="text-sm text-brand underline">{d.address}</a>}
          {d.reference && <p className="text-sm text-ink-muted">Referência: {d.reference}</p>}
          {tel && <a href={`tel:${tel}`} className="mt-1 flex items-center gap-1 text-sm text-ink"><Phone aria-hidden="true" className="size-4" />Ligar para o cliente</a>}
        </div>
      </div>
      <LiveLocation orderId={d.orderId} pickupAddress={d.businessAddress} dropoffAddress={d.address} />
      {(
        <p className="flex items-start gap-2 rounded-xl bg-muted p-3 text-sm text-ink">
          <Banknote aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Pagamento: {PAYMENT_LABEL[d.payment]} · total {formatBRL(d.totalCents)}{d.changeForCents ? ` · levar troco para ${formatBRL(d.changeForCents)}` : ''}. Combine o repasse com o estabelecimento.
        </p>
      )}
      {d.status === 'accepted' ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pickup.isPending || (!!d.orderStatus && d.orderStatus !== 'ready')} onClick={() => pickup.mutate()} className={primary}>Peguei o pedido</button>
          {d.orderStatus && d.orderStatus !== 'ready' && <p className="w-full text-sm text-ink-muted">{PREP_LABEL[d.orderStatus] ?? 'Pedido em preparo'}. A coleta é liberada quando a loja marcar como pronto.</p>}
          <button type="button" disabled={release.isPending} onClick={() => { if (window.confirm('Liberar esta entrega para outro entregador?')) release.mutate() }} className={secondary}>Liberar entrega</button>
        </div>
      ) : (
        verified ? (
          <div role="status" className="flex flex-col items-start gap-2 rounded-xl border border-success p-3">
            <p className="text-base font-bold text-success">Código confirmado!</p>
            <p className="text-sm text-ink">Pode entregar o pedido ao cliente.</p>
            <button type="button" disabled={finish.isPending} onClick={() => finish.mutate()} className={primary}>
              {finish.isPending ? 'Finalizando…' : 'FINALIZAR ENTREGA'}
            </button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (/^\d{4}$/.test(code)) verify.mutate()
            }}
          >
            <p className="text-sm text-ink">Ao chegar, peça ao cliente o código de 4 dígitos que aparece no app dele.</p>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor={`code-${d.orderId}`} className="mb-1 block text-sm font-medium text-ink">Código do cliente</label>
                <input id={`code-${d.orderId}`} inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={4} value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className="min-h-12 w-32 rounded-xl border border-line bg-surface px-3 text-center text-xl tracking-widest text-ink" />
              </div>
              <button type="submit" disabled={verify.isPending || code.length !== 4} className={primary}>{verify.isPending ? 'Conferindo…' : 'Confirmar código'}</button>
            </div>
            {codeMsg && <p role="alert" className="text-sm font-semibold text-danger">{codeMsg}</p>}
          </form>
        )
      )}
    </section>
  )
}

/** Entregador próprio: só as entregas que o comércio atribuiu a ele (não recebe ofertas da rede independente). */
function OwnCard({ d }: { d: OwnDelivery }) {
  const qc = useQueryClient()
  const toast = useToast()
  const step = useMutation({
    mutationFn: (s: 'out_for_delivery' | 'delivered') => ownDeliveryStatus(d.orderId, s),
    onSuccess: (_v, s) => { toast.success(s === 'delivered' ? 'Entrega concluída!' : 'Saída registrada. O cliente foi avisado.'); void qc.invalidateQueries({ queryKey: ['courier', 'own'] }) },
    onError: (e) => toast.error(msg(e)),
  })
  const tel = phoneDigits(d.customerPhone)
  const bizTel = phoneDigits(d.businessPhone)
  return (
    <li className={`${box} flex flex-col gap-2`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-ink">#{d.code} · {d.businessName}</p>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-ink">{STATUS_LABEL[d.status as keyof typeof STATUS_LABEL] ?? d.status}</span>
      </div>
      {d.businessAddress && <p className="text-sm text-ink"><Package aria-hidden="true" className="mr-1 inline size-4" />Retirar em: <a href={googleMapsRoute(null, d.businessAddress) ?? undefined} target="_blank" rel="noopener noreferrer" className="underline">{d.businessAddress}</a></p>}
      <p className="text-sm text-ink"><MapPin aria-hidden="true" className="mr-1 inline size-4" />Entregar para {d.customerName}{d.address ? <>: <a href={googleMapsRoute(null, d.address) ?? undefined} target="_blank" rel="noopener noreferrer" className="underline">{d.address}</a></> : null}{d.reference ? ` (${d.reference})` : ''}</p>
      <p className="text-sm text-ink-muted">{PAYMENT_LABEL[d.payment]} · total {formatBRL(d.totalCents)}{d.changeForCents ? ` · troco para ${formatBRL(d.changeForCents)}` : ''}</p>
      <LiveLocation orderId={d.orderId} pickupAddress={d.businessAddress} dropoffAddress={d.address} />
      <div className="flex flex-wrap gap-2">
        {d.status === 'ready' && <button type="button" disabled={step.isPending} onClick={() => step.mutate('out_for_delivery')} className={primary}>Saí para entrega</button>}
        {d.status === 'out_for_delivery' && <button type="button" disabled={step.isPending} onClick={() => step.mutate('delivered')} className={primary}>Confirmar entrega</button>}
        {(d.status === 'accepted' || d.status === 'preparing') && <p className="text-sm text-ink-muted">A loja está preparando. A saída é liberada quando o pedido ficar pronto.</p>}
        {tel && <a href={`tel:${tel}`} className="pressable inline-flex min-h-11 items-center gap-1 rounded-full border border-line px-4 text-sm font-semibold text-ink"><Phone aria-hidden="true" className="size-4" />Cliente</a>}
        {bizTel && <a href={`tel:${bizTel}`} className="pressable inline-flex min-h-11 items-center gap-1 rounded-full border border-line px-4 text-sm font-semibold text-ink"><Phone aria-hidden="true" className="size-4" />Loja</a>}
      </div>
    </li>
  )
}

export function OwnDeliveriesPanel() {
  const active = useQuery({ queryKey: ['courier', 'own', 'active'], queryFn: () => ownDeliveries(true), refetchInterval: 20_000 })
  const history = useQuery({ queryKey: ['courier', 'own', 'history'], queryFn: () => ownDeliveries(false) })
  return (
    <section aria-labelledby="own-deliveries" className="flex flex-col gap-3">
      <h2 id="own-deliveries" className="text-lg font-semibold text-ink">Entregas da loja</h2>
      <p className="text-sm text-ink-muted">Você é entregador próprio: aparecem aqui só as entregas que o estabelecimento atribuir a você.</p>
      {active.isError ? <ErrorState error={active.error} onRetry={() => void active.refetch()} /> : (active.data ?? []).length === 0 ? (
        <EmptyState icon={Truck} title={active.isLoading ? 'Carregando…' : 'Nenhuma entrega atribuída agora'} description="Quando a loja atribuir um pedido a você, ele aparece aqui e você recebe um aviso." />
      ) : (
        <ul className="flex flex-col gap-2">{active.data!.map((d) => <OwnCard key={d.orderId} d={d} />)}</ul>
      )}
      {(history.data ?? []).length > 0 && (
        <div>
          <h3 className="mb-1 text-base font-semibold text-ink">Histórico</h3>
          <ul className="divide-y divide-line text-sm">
            {history.data!.map((d) => <li key={d.orderId} className="flex justify-between gap-2 py-2"><span>#{d.code} · {d.businessName}</span><span className="text-ink-muted">{STATUS_LABEL[d.status as keyof typeof STATUS_LABEL] ?? d.status}</span></li>)}
          </ul>
        </div>
      )}
    </section>
  )
}

export function CourierArea() {
  const { session, authz } = useAuth()
  const ownCourier = !!authz?.memberships.some((m) => m.role === 'courier_own')
  const userId = session?.user.id
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['courier', 'me', userId ?? ''], queryFn: () => getMyCourier(userId!), enabled: !!userId })
  const approved = q.data?.status === 'approved'
  const active = useQuery({ queryKey: ['courier', 'active'], queryFn: () => myDeliveries(true), enabled: approved, refetchInterval: 20_000 })
  const offers = useQuery({ queryKey: ['courier', 'offers'], queryFn: listOffers, enabled: approved && !!q.data?.isOnline && (active.data ?? []).length === 0, refetchInterval: 15_000 })
  const earnings = useQuery({ queryKey: ['courier', 'earnings'], queryFn: getEarnings, enabled: approved })
  const history = useQuery({ queryKey: ['courier', 'history'], queryFn: () => myDeliveries(false), enabled: approved })
  const toggle = useMutation({
    mutationFn: (on: boolean) => setOnline(on),
    onSuccess: (on) => {
      toast.success(on ? 'Você está disponível.' : 'Você está indisponível.')
      void qc.invalidateQueries({ queryKey: ['courier'] })
    },
    onError: (e) => toast.error(msg(e)),
  })
  const decline = useMutation({
    mutationFn: declineOffer,
    onSuccess: () => { toast.success('Oferta recusada.'); void qc.invalidateQueries({ queryKey: ['courier', 'offers'] }) },
    onError: (e) => { toast.error(msg(e)); void qc.invalidateQueries({ queryKey: ['courier', 'offers'] }) },
  })
  const locate = useMutation({
    mutationFn: () =>
      new Promise<void>((resolve, reject) => {
        if (!('geolocation' in navigator)) return reject(new Error('Este aparelho não informa a localização.'))
        navigator.geolocation.getCurrentPosition(
          (p) => void shareLocation(p.coords.latitude, p.coords.longitude).then(resolve, reject),
          () => reject(new Error('Permissão de localização negada.')),
          { enableHighAccuracy: true, timeout: 15_000 },
        )
      }),
    onSuccess: () => toast.success('Localização compartilhada com a Tucaí.'),
    onError: (e) => toast.error(msg(e)),
  })
  const accept = useMutation({
    mutationFn: acceptDelivery,
    onSuccess: () => { toast.success('Entrega aceita. Vá até o estabelecimento.'); void qc.invalidateQueries({ queryKey: ['courier'] }) },
    onError: (e) => { toast.error(msg(e)); void qc.invalidateQueries({ queryKey: ['courier', 'offers'] }) },
  })

  if (q.isLoading) return <Page><p role="status" className="text-sm text-ink-muted">Carregando…</p></Page>
  if (q.isError) return <Page><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Page>
  const c = q.data
  if ((!c || c.status !== 'approved') && ownCourier) {
    return (
      <Page>
        <PageHeader icon={Truck} title="Área do entregador" subtitle="Entregador próprio do estabelecimento" />
        <OwnDeliveriesPanel />
      </Page>
    )
  }
  if (!c || c.status !== 'approved') {
    return (
      <Page>
        <EmptyState icon={Truck} title="Área exclusiva de entregadores aprovados" description="Faça ou acompanhe seu cadastro na página de entregadores." action={<Link to="/entregadores" className="pressable inline-flex min-h-11 items-center rounded-full bg-orange px-5 text-sm font-semibold text-ink">Ir para o cadastro</Link>} />
      </Page>
    )
  }
  const current = active.data ?? []
  const e = earnings.data
  const deliveriesView = (
    <>
      <section aria-labelledby="disp" className={`${box} flex flex-col items-start gap-3`}>
        <h2 id="disp" className="text-lg font-semibold text-ink">Disponibilidade</h2>
        <p className={`inline-flex items-center gap-2 text-sm font-semibold ${c.isOnline ? 'text-success' : 'text-ink-muted'}`}>
          <span aria-hidden="true" className={`size-2.5 rounded-full ${c.isOnline ? 'bg-success' : 'bg-line'}`} />
          {c.isOnline ? 'Disponível para entregas' : 'Indisponível'}
        </p>
        <button type="button" disabled={toggle.isPending} onClick={() => toggle.mutate(!c.isOnline)} className={`pressable inline-flex min-h-12 items-center gap-2 rounded-full px-6 text-base font-semibold ${c.isOnline ? 'border border-line text-ink' : 'bg-orange text-ink'}`}>
          <Power aria-hidden="true" className="size-5" />{c.isOnline ? 'Ficar indisponível' : 'Ficar disponível'}
        </button>
        {c.isOnline && (
          <button type="button" disabled={locate.isPending} onClick={() => locate.mutate()} className={secondary}>
            <MapPin aria-hidden="true" className="size-4" />{locate.isPending ? 'Obtendo localização…' : 'Compartilhar minha localização'}
          </button>
        )}
        <p className="text-xs text-ink-muted">Opcional. A localização só é enviada quando você toca no botão e é apagada quando fica indisponível.</p>
      </section>

      {active.isError ? <ErrorState error={active.error} onRetry={() => void active.refetch()} /> : current.map((d) => <ActiveDelivery key={d.orderId} d={d} />)}

      {current.length === 0 && (
        <section aria-labelledby="ofertas" className="flex flex-col gap-2">
          <h2 id="ofertas" className="text-lg font-semibold text-ink">Ofertas na sua cidade</h2>
          {!c.isOnline ? (
            <EmptyState icon={Navigation} title="Você está indisponível" description="Fique disponível para receber ofertas de entrega." />
          ) : offers.isError ? (
            <ErrorState error={offers.error} onRetry={() => void offers.refetch()} />
          ) : (offers.data ?? []).length === 0 ? (
            <EmptyState icon={Navigation} title={offers.isLoading ? 'Buscando ofertas…' : 'Nenhuma oferta agora'} description="A lista atualiza sozinha. Pedidos aparecem assim que são feitos; a coleta é liberada quando a loja marca como pronto." />
          ) : (
            <ul className="flex flex-col gap-2">
              {(offers.data ?? []).map((o) => (
                <li key={o.orderId} className={`${box} flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`}>
                  <div className="text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Nova entrega disponível{o.city ? ` · ${o.city}` : ''}</p>
                    <p className="font-semibold text-ink">{o.businessName}</p>
                    {o.orderStatus && <p className="text-ink">{PREP_LABEL[o.orderStatus] ?? o.orderStatus}</p>}
                    {o.businessAddress && <p className="text-ink-muted">Coleta: {o.businessAddress}</p>}
                    <p className="text-ink-muted">Destino: {o.neighborhood ?? 'informado após aceitar'} · {o.itemsCount} {o.itemsCount === 1 ? 'item' : 'itens'}</p>
                    <OfferDeadline expiresAt={o.expiresAt} round={o.round} />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-lg font-bold text-success">{formatBRL(o.payCents)}</span>
                    <button type="button" disabled={decline.isPending} onClick={() => decline.mutate(o.orderId)} className={secondary}>Recusar</button>
                    <button type="button" disabled={accept.isPending} onClick={() => accept.mutate(o.orderId)} className={primary}>Aceitar entrega</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-ink-muted">Aparecem aqui os pedidos com “entregador parceiro Tucaí” da sua cidade, já no momento do pedido (a coleta só é liberada quando a loja marca como pronto). Retiradas e entregas feitas pela própria loja não geram oferta. Distância e tempo não são estimados: a Tucaí ainda não usa serviço de mapas. Endereço completo e contato do cliente aparecem após aceitar.</p>
        </section>
      )}

    </>
  )
  return (
    <Page>
      <PageHeader icon={Truck} title="Área do entregador" subtitle={`${c.fullName} · ${VEHICLE_LABEL[c.vehicle]}${c.plate ? ` · ${c.plate}` : ''}`} />
      {ownCourier && <OwnDeliveriesPanel />}
      <CourierTabs available={e?.availableCents ?? 0} />
      <Routes>
        <Route index element={deliveriesView} />
        <Route path="entregas" element={deliveriesView} />
        <Route path="ganhos" element={<EarningsPanel e={e} error={earnings.isError ? earnings.error : null} onRetry={() => void earnings.refetch()} history={history.data ?? []} />} />
        <Route path="saques" element={<WithdrawalsPanel e={e} />} />
        <Route path="*" element={<Navigate to="/entregador" replace />} />
      </Routes>
    </Page>
  )
}

const dayBR = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7)

/** Abas do entregador: entregas, ganhos e saques (cada uma com sua cor). */
function CourierTabs({ available }: { available: number }) {
  const tabs = [
    { to: '/entregador', label: 'Entregas', icon: Truck, tone: 'bg-muted text-ink', on: 'bg-surface ring-orange', end: true },
    { to: '/entregador/ganhos', label: 'Ganhos', icon: PiggyBank, tone: 'bg-muted text-ink', on: 'bg-surface ring-orange', end: false },
    { to: '/entregador/saques', label: 'Saques', icon: Wallet, tone: 'bg-muted text-ink', on: 'bg-surface ring-orange', end: false },
  ]
  return (
    <nav aria-label="Seções do entregador" className="grid grid-cols-3 gap-2">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) => `pressable flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl border border-line p-2 text-sm font-semibold text-ink sm:flex-row sm:gap-2 ${isActive ? `${t.on} ring-2` : 'bg-surface hover:bg-muted'}`}
        >
          <span aria-hidden="true" className={`grid size-8 place-items-center rounded-lg ${t.tone}`}><t.icon className="size-4" /></span>
          <span>{t.label}</span>
          {t.label === 'Saques' && available > 0 && <span className="rounded-full bg-muted px-2 text-xs font-bold text-ink">{formatBRL(available)}</span>}
        </NavLink>
      ))}
    </nav>
  )
}

function Money({ label, value, hint, icon: Icon, tone }: { label: string; value: string; hint?: string; icon: typeof Truck; tone: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <dt className="text-xs font-medium text-ink-muted sm:text-sm">{label}</dt>
        <span aria-hidden="true" className={`grid size-8 shrink-0 place-items-center rounded-lg ${tone}`}><Icon className="size-4" /></span>
      </div>
      <dd className="mt-1 text-xl font-bold tabular-nums text-ink sm:text-2xl">{value}</dd>
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  )
}

function EarningsPanel({ e, error, onRetry, history }: { e?: CourierEarnings; error: unknown; onRetry: () => void; history: CourierDelivery[] }) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  const v = (n?: number) => (n === undefined ? '…' : formatBRL(n))
  return (
    <section aria-labelledby="ganhos" className="flex flex-col gap-3">
      <h2 id="ganhos" className="text-lg font-semibold text-ink">Ganhos</h2>
      <dl className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <Money label="Hoje" value={v(e?.todayCents)} icon={Clock} tone="bg-muted text-ink" />
        <Money label="Últimos 7 dias" value={v(e?.weekCents)} icon={CalendarClock} tone="bg-muted text-ink" />
        <Money label="Total ganho" value={v(e?.totalCents)} icon={PiggyBank} tone="bg-muted text-ink" />
        <Money label="Entregas feitas" value={e ? String(e.deliveries) : '…'} icon={Package} tone="bg-muted text-ink" />
      </dl>
      {e?.wallet && (
        <div className={`${box} flex flex-col gap-2`}>
          <p className="text-sm font-semibold text-ink">Como funciona</p>
          <p className="text-sm text-ink-muted">
            Cada entrega fica <strong className="text-ink">guardada {e.holdDays} dias</strong> e depois vai para o saldo disponível. Não é bloqueio: é para você juntar um valor maior e sacar de uma vez, sem sacar de 5 em 5 reais.
          </p>
          <Link to="/entregador/saques" className="pressable inline-flex min-h-11 w-fit items-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-surface">
            <Wallet aria-hidden="true" className="size-4" />Ver saldo e sacar
          </Link>
        </div>
      )}
      {history.length > 0 && (
        <div className={box}>
          <h3 className="mb-2 text-sm font-semibold text-ink">Últimas entregas</h3>
          <ul className="divide-y divide-line text-sm">
            {history.map((h) => (
              <li key={h.orderId} className="flex justify-between gap-2 py-2"><span className="min-w-0 truncate text-ink">#{h.code} · {h.businessName}</span><span className="font-semibold tabular-nums text-success">{formatBRL(h.payCents)}</span></li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-ink-muted">Valor por entrega concluída, conforme a regra de repasse vigente (gravada em cada pedido).</p>
    </section>
  )
}

function WithdrawalsPanel({ e }: { e?: CourierEarnings }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [pix, setPix] = useState('')
  const list = useQuery({ queryKey: ['courier', 'withdrawals'], queryFn: listWithdrawals, enabled: !!e?.wallet })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['courier'] })
  const ask = useMutation({
    mutationFn: () => requestWithdrawal(pix),
    onSuccess: (cents) => { toast.success(`Saque de ${formatBRL(cents)} enviado para a Tucaí.`); setPix(''); refresh() },
    onError: (err) => toast.error(msg(err)),
  })
  const cancel = useMutation({ mutationFn: cancelWithdrawal, onSuccess: () => { toast.success('Saque cancelado.'); refresh() }, onError: (err) => toast.error(msg(err)) })
  if (!e) return <p role="status" className="text-sm text-ink-muted">Carregando…</p>
  if (!e.wallet) return <EmptyState icon={Wallet} title="Saques em preparação" description="A carteira com saques aparece aqui assim que a Tucaí atualizar o sistema." />
  const open = (list.data ?? []).some((w) => w.status === 'solicitado')
  return (
    <section aria-labelledby="saques" className="flex flex-col gap-3">
      <h2 id="saques" className="text-lg font-semibold text-ink">Saques</h2>
      <dl className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <Money label="Disponível para saque" value={formatBRL(e.availableCents)} icon={CheckCircle2} tone="bg-muted text-ink" />
        <Money label={`Guardado (${e.holdDays} dias)`} value={formatBRL(e.heldCents)} icon={Hourglass} tone="bg-muted text-ink" />
        <Money label="Em análise" value={formatBRL(e.pendingCents)} icon={Clock} tone="bg-muted text-ink" />
        <Money label="Já sacado" value={formatBRL(e.withdrawnCents)} icon={Banknote} tone="bg-muted text-ink" />
      </dl>
      {e.releases.length > 0 && (
        <div className={box}>
          <h3 className="mb-2 text-sm font-semibold text-ink">Próximas liberações</h3>
          <ul className="flex flex-wrap gap-2">
            {e.releases.map((r) => (
              <li key={r.dia} className="rounded-full bg-muted px-3 py-1 text-sm text-ink"><strong>{formatBRL(r.cents)}</strong> em {dayBR(r.dia)}</li>
            ))}
          </ul>
        </div>
      )}
      <form onSubmit={(ev) => { ev.preventDefault(); ask.mutate() }} className={`${box} flex flex-col gap-3`}>
        <p className="text-sm text-ink">
          {open ? 'Você já tem um saque em análise. Assim que a Tucaí pagar, você pode pedir outro.' : e.availableCents > 0
            ? <>Sacar <strong>{formatBRL(e.availableCents)}</strong> (todo o saldo disponível).</>
            : `Ainda não há saldo disponível. Cada entrega fica guardada ${e.holdDays} dias antes de poder ser sacada.`}
        </p>
        <label className="text-sm font-medium text-ink">Chave Pix para receber
          <input value={pix} onChange={(ev) => setPix(ev.target.value)} required minLength={3} maxLength={140} autoComplete="off" disabled={open || e.availableCents <= 0}
            className="mt-1 min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink disabled:opacity-50" />
        </label>
        <button type="submit" disabled={ask.isPending || open || e.availableCents <= 0} className="pressable inline-flex min-h-12 w-fit items-center gap-2 rounded-full bg-brand px-5 text-base font-semibold text-surface disabled:opacity-50">
          <Wallet aria-hidden="true" className="size-5" />{ask.isPending ? 'Enviando…' : 'Pedir saque'}
        </button>
        <p className="text-xs text-ink-muted">A Tucaí confere e faz a transferência. Você recebe um aviso quando o saque for pago.</p>
      </form>
      <div className={box}>
        <h3 className="mb-2 text-sm font-semibold text-ink">Histórico de saques</h3>
        {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : (list.data ?? []).length === 0 ? (
          <p className="text-sm text-ink-muted">{list.isLoading ? 'Carregando…' : 'Nenhum saque ainda.'}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {(list.data ?? []).map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-ink">{new Date(w.requestedAt).toLocaleDateString('pt-BR')} · <strong>{formatBRL(w.amountCents)}</strong>{w.note ? <span className="text-ink-muted"> · {w.note}</span> : null}</span>
                <span className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${w.status === 'pago' ? 'bg-muted text-success' : w.status === 'recusado' ? 'bg-muted text-danger' : 'bg-muted text-ink'}`}>{WITHDRAWAL_LABEL[w.status]}</span>
                  {w.status === 'solicitado' && <button type="button" disabled={cancel.isPending} onClick={() => cancel.mutate(w.id)} className="pressable min-h-9 rounded-full px-3 text-sm font-semibold text-ink-muted hover:bg-muted">Cancelar</button>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
