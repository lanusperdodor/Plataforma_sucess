import { Briefcase, Search, Users } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BusinessCard } from '../components/cards/BusinessCard.tsx'
import { EmptyState } from '../components/feedback/EmptyState.tsx'
import { Page, PageHeader } from '../components/nav/PageHeader.tsx'
import { useBusinesses } from '../features/catalog/hooks.ts'
import { DEMO_JOBS, DEMO_POSTS } from '../features/demo/preview-data.ts'
import { useCurrentCity } from '../features/location/cityStore.ts'

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/** Busca única: estabelecimentos, vagas e publicações (texto tratado como literal, sem acento). */
export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const [term, setTerm] = useState(q)
  const { city } = useCurrentCity()
  const r = useBusinesses(city?.id, 'restaurante')
  const s = useBusinesses(city?.id, 'loja')
  const v = useBusinesses(city?.id, 'servico')
  const needle = fold(q.trim())
  const ok = needle.length >= 2
  const businesses = ok ? [...(r.data ?? []), ...(s.data ?? []), ...(v.data ?? [])].filter((b) => fold(`${b.name} ${b.description ?? ''}`).includes(needle)) : []
  const jobs = ok ? DEMO_JOBS.filter((j) => fold(`${j.title} ${j.businessName} ${j.category}`).includes(needle)) : []
  const posts = ok ? DEMO_POSTS.filter((p) => fold(`${p.text} ${p.businessName}`).includes(needle)) : []
  const total = businesses.length + jobs.length + posts.length
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setParams(term.trim() ? { q: term.trim() } : {}, { replace: true })
  }

  return (
    <Page>
      <PageHeader icon={Search} title="Buscar" subtitle="Restaurantes, lojas, serviços, vagas e publicações." />
      <form role="search" onSubmit={submit} className="flex gap-2">
        <label htmlFor="busca-q" className="sr-only">Buscar</label>
        <input id="busca-q" type="search" autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Ex.: pizza, farmácia, atendente…" className="min-h-14 min-w-0 flex-1 rounded-full border border-line bg-surface px-5 text-base text-ink placeholder:text-ink-muted" />
        <button type="submit" className="pressable min-h-14 rounded-full bg-brand px-5 text-sm font-semibold text-surface">Buscar</button>
      </form>
      {!ok ? (
        <p className="text-sm text-ink-muted">Digite ao menos 2 letras.</p>
      ) : total === 0 ? (
        <EmptyState icon={Search} title={`Nada encontrado para “${q}”`} description="Tente outra palavra ou navegue por Explorar." action={<Link to="/explorar" className="pressable inline-flex min-h-11 items-center rounded-full bg-orange px-5 text-sm font-semibold text-ink">Ir para Explorar</Link>} />
      ) : (
        <>
          <p className="text-sm text-ink-muted" aria-live="polite">{total} {total === 1 ? 'resultado' : 'resultados'}</p>
          {businesses.length > 0 && (
            <section aria-labelledby="b-est" className="flex flex-col gap-3">
              <h2 id="b-est" className="text-lg font-semibold text-ink">Estabelecimentos</h2>
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">{businesses.map((b) => <li key={b.id}><BusinessCard business={b} /></li>)}</ul>
            </section>
          )}
          {jobs.length > 0 && (
            <section aria-labelledby="b-vag" className="flex flex-col gap-2">
              <h2 id="b-vag" className="text-lg font-semibold text-ink">Vagas</h2>
              <ul className="flex flex-col gap-2">{jobs.map((j) => <li key={j.id}><Link to="/vagas" className="pressable flex min-h-11 items-center gap-2 rounded-card border border-line bg-surface p-3 text-sm"><Briefcase aria-hidden="true" className="size-4 text-warm" /><span className="font-semibold text-ink">{j.title}</span><span className="truncate text-ink-muted">· {j.businessName}</span></Link></li>)}</ul>
            </section>
          )}
          {posts.length > 0 && (
            <section aria-labelledby="b-pub" className="flex flex-col gap-2">
              <h2 id="b-pub" className="text-lg font-semibold text-ink">Comunidade</h2>
              <ul className="flex flex-col gap-2">{posts.map((p) => <li key={p.id}><Link to="/comunidade" className="pressable flex min-h-11 items-center gap-2 rounded-card border border-line bg-surface p-3 text-sm"><Users aria-hidden="true" className="size-4 text-warm" /><span className="truncate text-ink">{p.text}</span></Link></li>)}</ul>
            </section>
          )}
        </>
      )}
    </Page>
  )
}