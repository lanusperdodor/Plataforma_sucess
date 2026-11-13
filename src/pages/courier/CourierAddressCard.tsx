import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPin } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AddressFields } from '../../components/forms/AddressFields.tsx'
import { useToast } from '../../components/feedback/toast-context.ts'
import { emptyAddress, formatAddress, validateAddress, type AddressErrors, type AddressParts } from '../../features/address/address.ts'
import { getCourierAddress, saveCourierAddress } from '../../features/address/repository.ts'

/** Endereço do entregador (visto só por ele e pela equipe da Tucaí que revisa cadastros). */
export function CourierAddressCard({ userId }: { userId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['courier', 'endereco', userId], queryFn: () => getCourierAddress(userId) })
  const [editing, setEditing] = useState(false)
  const [addr, setAddr] = useState<AddressParts>(emptyAddress())
  const [errors, setErrors] = useState<AddressErrors>({})
  useEffect(() => { if (q.data && !editing) setAddr(q.data) }, [q.data, editing])
  const save = useMutation({
    mutationFn: () => saveCourierAddress(addr),
    onSuccess: () => { toast.success('Endereço salvo.'); setEditing(false); void qc.invalidateQueries({ queryKey: ['courier', 'endereco', userId] }) },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.'),
  })
  const submit = () => {
    const e = validateAddress(addr)
    setErrors(e)
    if (Object.keys(e).length === 0) save.mutate()
  }
  if (q.isLoading) return null
  const open = editing || !q.data
  return (
    <section aria-labelledby="ent-endereco" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 md:p-6">
      <h2 id="ent-endereco" className="inline-flex items-center gap-2 text-lg font-semibold text-ink"><MapPin aria-hidden="true" className="size-5" />Meu endereço</h2>
      {!open && q.data && (
        <>
          <p className="text-sm text-ink">{formatAddress(q.data)}</p>
          <button type="button" onClick={() => setEditing(true)} className="pressable inline-flex min-h-11 w-fit items-center rounded-full border border-line px-5 text-sm font-semibold text-ink">Alterar endereço</button>
        </>
      )}
      {open && (
        <>
          {!q.data && <p className="text-sm text-ink-muted">Informe onde você mora. Só você e a equipe da Tucaí que analisa os cadastros veem este endereço.</p>}
          <AddressFields idPrefix="ent-end" value={addr} onChange={(a) => { setEditing(true); setAddr(a) }} errors={errors} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={submit} disabled={save.isPending} className="pressable inline-flex min-h-11 items-center rounded-full bg-orange px-6 text-sm font-semibold text-ink disabled:opacity-50">
              {save.isPending ? 'Salvando…' : 'Salvar endereço'}
            </button>
            {q.data && <button type="button" onClick={() => { setEditing(false); setErrors({}) }} className="pressable inline-flex min-h-11 items-center rounded-full border border-line px-5 text-sm font-semibold text-ink">Cancelar</button>}
          </div>
        </>
      )}
    </section>
  )
}
