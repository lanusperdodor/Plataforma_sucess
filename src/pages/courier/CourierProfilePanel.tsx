import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IdCard, Lock } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../../components/feedback/toast-context.ts'
import { useCities } from '../../features/catalog/hooks.ts'
import { VEHICLE_LABEL, courierProfileSchema, updateCourierProfile, vehicles, type CourierProfileForm, type MyCourier } from '../../features/courier/repository.ts'
import { CourierAddressCard } from './CourierAddressCard.tsx'

const field = 'min-h-14 w-full rounded-2xl border border-line bg-surface px-4 text-lg text-ink'
const label = 'mb-1 block text-base font-semibold text-ink'

/** Meus dados (entregador): celular, veículo e endereço. Nome e cidade só mudam com a equipe Tucaí. */
export function CourierProfilePanel({ c, userId }: { c: MyCourier | null; userId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const cities = useCities()
  const [v, setV] = useState<CourierProfileForm>({ phone: c?.phone ?? '', vehicle: c?.vehicle ?? 'moto', plate: c?.plate ?? '', cnh: c?.cnh ?? '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const save = useMutation({
    mutationFn: () => updateCourierProfile(v),
    onSuccess: () => { toast.success('Dados atualizados.'); void qc.invalidateQueries({ queryKey: ['courier'] }) },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.'),
  })
  const set = <K extends keyof CourierProfileForm>(k: K, val: CourierProfileForm[K]) => setV((p) => ({ ...p, [k]: val }))
  const motor = v.vehicle === 'moto' || v.vehicle === 'carro'
  const city = (cities.data ?? []).find((x) => x.id === c?.cityId)
  const err = (k: string) => (errors[k] ? <p role="alert" className="mt-1 text-base text-danger">{errors[k]}</p> : null)

  return (
    <div className="flex flex-col gap-4">
      {c && (
        <form noValidate onSubmit={(e) => {
          e.preventDefault()
          const p = courierProfileSchema.safeParse(v)
          if (!p.success) { setErrors(Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message]))); return }
          setErrors({}); save.mutate()
        }} className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 md:p-6">
          <h2 className="flex items-center gap-2 text-xl font-bold text-ink"><IdCard aria-hidden="true" className="size-6" />Meus dados</h2>
          <dl className="grid grid-cols-1 gap-3 rounded-2xl bg-muted p-4 text-base sm:grid-cols-2">
            <div><dt className="text-ink-muted">Nome</dt><dd className="font-semibold text-ink">{c.fullName}</dd></div>
            <div><dt className="text-ink-muted">Cidade onde atua</dt><dd className="font-semibold text-ink">{city ? `${city.name}, ${city.state}` : '—'}</dd></div>
            <p className="text-sm text-ink-muted sm:col-span-2">Para mudar nome ou cidade, fale com a equipe Tucaí.</p>
          </dl>
          <div>
            <label htmlFor="md-tel" className={label}>Celular (WhatsApp)</label>
            <input id="md-tel" type="tel" autoComplete="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} className={field} />
            {err('phone')}
          </div>
          <fieldset>
            <legend className={label}>Veículo</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {vehicles.map((x) => (
                <label key={x} className={`pressable flex min-h-14 items-center justify-center rounded-2xl border-2 text-lg font-semibold ${v.vehicle === x ? 'border-brand bg-muted text-ink' : 'border-line text-ink'}`}>
                  <input type="radio" name="md-veiculo" className="sr-only" checked={v.vehicle === x} onChange={() => set('vehicle', x)} />{VEHICLE_LABEL[x]}
                </label>
              ))}
            </div>
          </fieldset>
          {motor && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="md-placa" className={label}>Placa</label>
                <input id="md-placa" autoCapitalize="characters" value={v.plate} onChange={(e) => set('plate', e.target.value.toUpperCase())} placeholder="ABC1D23" className={field} />
                {err('plate')}
              </div>
              <div>
                <label htmlFor="md-cnh" className={label}>Categoria da CNH</label>
                <select id="md-cnh" value={v.cnh} onChange={(e) => set('cnh', e.target.value)} className={field}>
                  <option value="">Escolha</option>
                  {['A', 'B', 'AB', 'AC', 'AD', 'AE'].map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
                {err('cnh')}
              </div>
            </div>
          )}
          <button type="submit" disabled={save.isPending} className="pressable inline-flex min-h-14 w-full items-center justify-center rounded-full bg-brand px-6 text-lg font-bold text-surface disabled:opacity-60">
            {save.isPending ? 'Salvando…' : 'Salvar meus dados'}
          </button>
        </form>
      )}
      <CourierAddressCard userId={userId} />
      <Link to="/perfil/privacidade" className="pressable inline-flex min-h-14 items-center justify-center gap-2 rounded-full border-2 border-line px-6 text-lg font-semibold text-ink">
        <Lock aria-hidden="true" className="size-5" />Privacidade e senha
      </Link>
    </div>
  )
}
