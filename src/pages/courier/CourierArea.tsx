import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, MapPin, Navigation, Package, Phone, Power, Truck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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
  completeDelivery,
  getEarnings,
  getMyCourier,
  listOffers,
  myDeliveries,
  pickupDelivery,
  releaseDelivery,
  setOnline,
  type CourierDelivery,
} from '../../features/courier/repository.ts'
import { PAYMENT_LABEL } from '../../features/orders/repository.ts'
import { formatBRL } from '../../lib/money.ts'
import { phoneDigits } from '../BusinessPage.tsx'

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
const mapsHref = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`

function ActiveDelivery({ d }: { d: CourierDelivery }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [code, setCode] = useState('')
  const refresh = () => void qc.invalidateQueries({ queryKey: ['courier'] })
  const pickup = useMutation({ mutationFn: () => pickupDelivery(d.orderId), onSuccess: () => { toast.success('Coleta confirmada.'); refresh() }, onError: (e) => toast.error(msg(e)) })
  const release = useMutation({ mutationFn: () => releaseDelivery(d.orderId), onSuccess: () => { toast.success('Entrega liberada para outro entregador.'); refresh() }, onError: (e) => toast.error(msg(e)) })
  const complete = useMutation({
    mutationFn: () => completeDelivery(d.orderId, code),
    onSuccess: (ok) => {
      if (ok) toast.success(`Entrega concluída! +${formatBRL(d.payCents)}`)
      else toast.error('Código incorreto. Peça ao cliente o código de 4 dígitos.')
      setCode('')
      refresh()
    },
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
          {d.businessAddress && <a href={mapsHref(d.businessAddress)} target="_blank" rel="noopener noreferrer" className="text-sm text-brand underline">{d.businessAddress}</a>}
          {bizTel && <a href={`tel:${bizTel}`} className="mt-1 flex items-center gap-1 text-sm text-ink"><Phone aria-hidden="true" className="size-4" />Ligar para a loja</a>}
        </div>
        <div className={`rounded-xl border p-3 ${d.status === 'picked_up' ? 'border-brand' : 'border-line'}`}>
          <p className="flex items-center gap-2 text-sm font-semibold text-ink"><MapPin aria-hidden="true" className="size-4" />2. Entregar para {d.customerName}</p>
          {d.address && <a href={mapsHref(d.address)} target="_blank" rel="noopener noreferrer" className="text-sm text-brand underline">{d.address}</a>}
          {d.reference && <p className="text-sm text-ink-muted">Referência: {d.reference}</p>}
          {tel && <a href={`tel:${tel}`} className="mt-1 flex items-center gap-1 text-sm text-ink"><Phone aria-hidden="true" className="size-4" />Ligar para o cliente</a>}
        </div>
      </div>
      {(
        <p className="flex items-start gap-2 rounded-xl bg-muted p-3 text-sm text-ink">
          <Banknote aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Pagamento: {PAYMENT_LABEL[d.payment]} · total {formatBRL(d.totalCents)}{d.changeForCents ? ` · levar troco para ${formatBRL(d.changeForCents)}` : ''}. Combine o repasse com o estabelecimento.
        </p>
      )}
      {d.status === 'accepted' ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pickup.isPending} onClick={() => pickup.mutate()} className={primary}>Peguei o pedido</button>
          <button type="button" disabled={release.isPending} onClick={() => { if (window.confirm('Liberar esta entrega para outro entregador?')) release.mutate() }} className={secondary}>Liberar entrega</button>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (/^\d{4}$/.test(code)) complete.mutate()
          }}
        >
          <div>
            <label htmlFor={`code-${d.orderId}`} className="mb-1 block text-sm font-medium text-ink">Código do cliente</label>
            <input id={`code-${d.orderId}`} inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="min-h-12 w-32 rounded-xl border border-line bg-surface px-3 text-center text-xl tracking-widest text-ink" />
          </div>
          <button type="submit" disabled={complete.isPending || code.length !== 4} className={primary}>Confirmar entrega</button>
        </form>
      )}
    </section>
  )
}

export function CourierArea() {
  const { session } = useAuth()
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
  if (!c || c.status !== 'approved') {
    return (
      <Page>
        <EmptyState icon={Truck} title="Área exclusiva de entregadores aprovados" description="Faça ou acompanhe seu cadastro na página de entregadores." action={<Link to="/entregadores" className="pressable inline-flex min-h-11 items-center rounded-full bg-orange px-5 text-sm font-semibold text-ink">Ir para o cadastro</Link>} />
      </Page>
    )
  }
  const current = active.data ?? []
  const e = earnings.data
  return (
    <Page>
      <PageHeader icon={Truck} title="Área do entregador" subtitle={`${c.fullName} · ${VEHICLE_LABEL[c.vehicle]}${c.plate ? ` · ${c.plate}` : ''}`} />
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
            <EmptyState icon={Navigation} title={offers.isLoading ? 'Buscando ofertas…' : 'Nenhuma oferta agora'} description="A lista atualiza sozinha. Pedidos aparecem quando o estabelecimento marca como pronto." />
          ) : (
            <ul className="flex flex-col gap-2">
              {(offers.data ?? []).map((o) => (
                <li key={o.orderId} className={`${box} flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`}>
                  <div className="text-sm">
                    <p className="font-semibold text-ink">{o.businessName}</p>
                    {o.businessAddress && <p className="text-ink-muted">Coleta: {o.businessAddress}</p>}
                    <p className="text-ink-muted">Destino: {o.neighborhood ?? 'informado após aceitar'} · {o.itemsCount} {o.itemsCount === 1 ? 'item' : 'itens'}</p>
                    <OfferDeadline expiresAt={o.expiresAt} round={o.round} />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-lg font-bold text-success">{formatBRL(o.payCents)}</span>
                    <button type="button" disabled={decline.isPending} onClick={() => decline.mutate(o.orderId)} className={secondary}>Recusar</button>
                    <button type="button" disabled={accept.isPending} onClick={() => accept.mutate(o.orderId)} className={primary}>Aceitar</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-ink-muted">Aparecem aqui os pedidos com “entregador parceiro Tucaí” da sua cidade, quando o estabelecimento marca como pronto. Retiradas e entregas feitas pela própria loja não geram oferta. Distância e tempo não são estimados: a Tucaí ainda não usa serviço de mapas. Endereço completo e contato do cliente aparecem após aceitar.</p>
        </section>
      )}

      <section aria-labelledby="ganhos" className={box}>
        <h2 id="ganhos" className="mb-3 text-lg font-semibold text-ink">Ganhos</h2>
        {earnings.isError ? (
          <ErrorState error={earnings.error} onRetry={() => void earnings.refetch()} />
        ) : (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[['Hoje', e?.todayCents], ['7 dias', e?.weekCents], ['Total', e?.totalCents]].map(([label, v]) => (
              <div key={label as string} className="rounded-xl bg-muted p-3"><dt className="text-xs text-ink-muted">{label}</dt><dd className="text-lg font-bold text-ink">{v === undefined ? '…' : formatBRL(v as number)}</dd></div>
            ))}
            <div className="rounded-xl bg-muted p-3"><dt className="text-xs text-ink-muted">Entregas</dt><dd className="text-lg font-bold text-ink">{e?.deliveries ?? '…'}</dd></div>
          </dl>
        )}
        {(history.data ?? []).length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-semibold text-ink">Últimas entregas</summary>
            <ul className="mt-2 divide-y divide-line text-sm">
              {(history.data ?? []).map((h) => (
                <li key={h.orderId} className="flex justify-between py-2"><span>#{h.code} · {h.businessName}</span><span>{formatBRL(h.payCents)}</span></li>
              ))}
            </ul>
          </details>
        )}
        <p className="mt-2 text-xs text-ink-muted">Valores por entrega concluída, conforme a regra de repasse vigente. O pagamento dos ganhos é combinado com a Tucaí enquanto o repasse automático não é contratado.</p>
      </section>
    </Page>
  )
}
