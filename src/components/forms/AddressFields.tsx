import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { lookupCep, maskCep, onlyDigits, type AddressErrors, type AddressParts } from '../../features/address/address.ts'

const field = 'min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink disabled:bg-muted'

interface Props {
  value: AddressParts
  onChange: (next: AddressParts) => void
  errors?: AddressErrors
  /** prefixo dos ids (dois formulários na mesma tela não colidem) */
  idPrefix: string
  /** consulta do CEP (injetável nos testes) */
  lookup?: typeof lookupCep
}

/**
 * Endereço em campos separados, igual em toda a Tucaí:
 * CEP (preenche cidade/UF e, quando o CEP é de rua, rua e bairro) · Rua · Número (ou "Sem número") · Complemento · Bairro · Cidade/UF.
 */
export function AddressFields({ value: v, onChange, errors = {}, idPrefix, lookup = lookupCep }: Props) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'found' | 'notfound' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  const last = useRef('')
  const current = useRef(v)
  current.current = v
  const set = (k: keyof AddressParts, val: string) => onChange({ ...current.current, [k]: val })
  const id = (k: string) => `${idPrefix}-${k}`
  const noNumber = v.number.trim().toUpperCase() === 'S/N'

  const cepDigits = onlyDigits(v.cep)
  useEffect(() => {
    if (cepDigits.length !== 8 || cepDigits === last.current) return
    last.current = cepDigits
    let alive = true
    setStatus('loading'); setMsg('')
    lookup(cepDigits)
      .then((r) => {
        if (!alive) return
        if (!r) { setStatus('notfound'); setMsg('CEP não encontrado. Confira os números ou preencha a cidade e a UF.'); return }
        const a = current.current
        // a cidade/UF vêm do CEP; rua e bairro só substituem se o CEP for de rua (CEP geral da cidade vem vazio)
        onChange({ ...a, city: r.city, uf: r.uf, street: r.street || a.street, district: r.district || a.district })
        setStatus('found')
        setMsg(r.street ? '' : 'CEP geral da cidade: digite a rua e o bairro.')
      })
      .catch((e: unknown) => { if (alive) { setStatus('error'); setMsg(e instanceof Error ? e.message : 'Não foi possível consultar o CEP.') } })
    return () => { alive = false }
    // a consulta depende só do CEP digitado
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cepDigits])

  const cityLocked = status === 'found'
  const err = (k: keyof AddressParts) => (errors[k] ? <p id={id(`${k}-err`)} role="alert" className="mt-1 text-xs text-danger">{errors[k]}</p> : null)
  const L = (k: string, text: string) => <label htmlFor={id(k)} className="mb-1 block text-sm font-medium text-ink">{text}</label>
  const aria = (k: keyof AddressParts) => ({ 'aria-invalid': !!errors[k], 'aria-describedby': errors[k] ? id(`${k}-err`) : undefined })

  return (
    <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-6">
      <legend className="sr-only">Endereço</legend>
      <div className="sm:col-span-2">
        {L('cep', 'CEP')}
        <div className="relative">
          <input id={id('cep')} inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" maxLength={9}
            value={maskCep(v.cep)} onChange={(e) => set('cep', maskCep(e.target.value))} className={field} {...aria('cep')} />
          {status === 'loading' && <Loader2 aria-hidden="true" className="absolute right-3 top-3.5 size-4 animate-spin text-ink-muted" />}
        </div>
        {err('cep')}
      </div>
      <div className="sm:col-span-3">
        {L('cidade', 'Cidade')}
        <input id={id('cidade')} autoComplete="address-level2" maxLength={80} value={v.city} readOnly={cityLocked}
          onChange={(e) => set('city', e.target.value)} placeholder="Preenchida pelo CEP" className={`${field} ${cityLocked ? 'bg-muted' : ''}`} {...aria('city')} />
        {err('city')}
      </div>
      <div className="sm:col-span-1">
        {L('uf', 'UF')}
        <input id={id('uf')} autoComplete="address-level1" maxLength={2} value={v.uf} readOnly={cityLocked}
          onChange={(e) => set('uf', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} className={`${field} uppercase ${cityLocked ? 'bg-muted' : ''}`} {...aria('uf')} />
        {err('uf')}
      </div>
      {msg && <p role="status" className={`text-xs sm:col-span-6 ${status === 'found' ? 'text-ink-muted' : 'text-danger'}`}>{msg}</p>}

      <div className="sm:col-span-4">
        {L('rua', 'Rua')}
        <input id={id('rua')} autoComplete="address-line1" maxLength={120} value={v.street} onChange={(e) => set('street', e.target.value)} className={field} {...aria('street')} />
        {err('street')}
      </div>
      <div className="sm:col-span-2">
        {L('numero', 'Número')}
        <input id={id('numero')} inputMode="numeric" maxLength={20} value={noNumber ? '' : v.number} disabled={noNumber}
          placeholder={noNumber ? 'Sem número' : ''} onChange={(e) => set('number', e.target.value)} className={field} {...aria('number')} />
        <label className="mt-1 flex items-center gap-2 text-xs text-ink-muted">
          <input type="checkbox" className="size-4" checked={noNumber} onChange={(e) => set('number', e.target.checked ? 'S/N' : '')} />Sem número
        </label>
        {err('number')}
      </div>
      <div className="sm:col-span-3">
        {L('bairro', 'Bairro')}
        <input id={id('bairro')} maxLength={80} value={v.district} onChange={(e) => set('district', e.target.value)} className={field} {...aria('district')} />
        {err('district')}
      </div>
      <div className="sm:col-span-3">
        {L('complemento', 'Complemento (opcional)')}
        <input id={id('complemento')} autoComplete="address-line2" maxLength={60} placeholder="Apto, bloco, casa dos fundos…" value={v.complement}
          onChange={(e) => set('complement', e.target.value)} className={field} {...aria('complement')} />
        {err('complement')}
      </div>
    </fieldset>
  )
}
