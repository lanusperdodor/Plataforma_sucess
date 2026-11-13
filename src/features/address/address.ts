/**
 * Endereço em campos separados (CEP, rua, número, complemento, bairro, cidade, UF), igual para cliente, loja e entregador.
 * O CEP é consultado no Worker (/api/cep/:cep), que preenche cidade/UF e, quando o CEP é de rua, rua e bairro.
 * O texto montado (formatAddress) continua indo para os campos de texto já existentes (pedido, loja), então tudo que
 * mostra endereço segue funcionando.
 */
import { z } from 'zod'

export interface AddressParts {
  cep: string
  street: string
  number: string
  complement: string
  district: string
  city: string
  uf: string
}

export const emptyAddress = (): AddressParts => ({ cep: '', street: '', number: '', complement: '', district: '', city: '', uf: '' })

export const onlyDigits = (s: string) => s.replace(/\D/g, '')
/** 37000000 → 37000-000 (aceita digitação parcial) */
export function maskCep(s: string): string {
  const d = onlyDigits(s).slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}

const UFS = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'])

export type AddressErrors = Partial<Record<keyof AddressParts, string>>

export function validateAddress(a: AddressParts): AddressErrors {
  const e: AddressErrors = {}
  if (onlyDigits(a.cep).length !== 8) e.cep = 'Digite o CEP com 8 números.'
  if (a.street.trim().length < 2) e.street = 'Digite a rua.'
  if (a.number.trim() === '') e.number = 'Digite o número (ou marque "Sem número").'
  if (a.district.trim().length < 2) e.district = 'Digite o bairro.'
  if (a.city.trim().length < 2) e.city = 'Digite o CEP para preencher a cidade.'
  if (!UFS.has(a.uf.trim().toUpperCase())) e.uf = 'UF inválida.'
  if (a.street.length > 120) e.street = 'Rua muito longa.'
  if (a.number.length > 20) e.number = 'Número muito longo.'
  if (a.complement.length > 60) e.complement = 'Complemento muito longo (até 60).'
  if (a.district.length > 80) e.district = 'Bairro muito longo.'
  return e
}
export const isAddressValid = (a: AddressParts) => Object.keys(validateAddress(a)).length === 0

/** "Rua A, 10, Apto 2 - Centro, Itaú de Minas/MG, CEP 37975-000" */
export function formatAddress(a: AddressParts): string {
  const t = (s: string) => s.trim().replace(/\s+/g, ' ')
  const first = [t(a.street), t(a.number), t(a.complement)].filter(Boolean).join(', ')
  const place = [t(a.city), t(a.uf).toUpperCase()].filter(Boolean).join('/')
  return [first, t(a.district), place].filter(Boolean).join(' - ') + (onlyDigits(a.cep).length === 8 ? `, CEP ${maskCep(a.cep)}` : '')
}

/** Formato compacto (até 200 caracteres) para a loja, que tem limite menor no banco. */
export const formatAddressShort = (a: AddressParts) => formatAddress(a).slice(0, 200)

/** Partes guardadas no banco (jsonb). Aceita null/antigo e devolve sempre o objeto completo. */
export const addressPartsSchema = z.object({
  cep: z.string().default(''), street: z.string().default(''), number: z.string().default(''), complement: z.string().default(''),
  district: z.string().default(''), city: z.string().default(''), uf: z.string().default(''),
})
export function toStoredParts(a: AddressParts): AddressParts {
  return { cep: onlyDigits(a.cep), street: a.street.trim(), number: a.number.trim(), complement: a.complement.trim(),
    district: a.district.trim(), city: a.city.trim(), uf: a.uf.trim().toUpperCase() }
}

const cepSchema = z.object({ cep: z.string(), street: z.string(), district: z.string(), city: z.string(), uf: z.string() })
export type CepResult = z.infer<typeof cepSchema>

/** Consulta o CEP pelo Worker. Devolve null quando o CEP não existe; lança erro quando o serviço está fora. */
export async function lookupCep(cep: string, fetcher: typeof fetch = fetch): Promise<CepResult | null> {
  const d = onlyDigits(cep)
  if (d.length !== 8) return null
  const res = await fetcher(`/api/cep/${d}`, { headers: { Accept: 'application/json' } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Não foi possível consultar o CEP agora. Preencha a cidade e a UF.')
  const parsed = cepSchema.safeParse(await res.json().catch(() => null))
  if (!parsed.success) throw new Error('Não foi possível consultar o CEP agora. Preencha a cidade e a UF.')
  return parsed.data
}
