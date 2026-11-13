/**
 * Endereço separado em partes (0042) para loja, cliente (perfil) e entregador.
 * Leitura tolerante: se o banco ainda não tiver a 0042, devolve null e o formulário apenas começa vazio.
 * A permissão é do banco (RLS / função), não desta camada.
 */
import { z } from 'zod'
import { RepositoryError, backendUnavailable, mapPostgrestError, outdatedSchema } from '../../lib/errors'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { addressPartsSchema, toStoredParts, type AddressParts } from './address'

type Res = { data: unknown; error: { code?: string; message: string } | null }
const row = z.object({ address_parts: addressPartsSchema.nullable().optional() }).nullable()

async function read(q: PromiseLike<Res>): Promise<AddressParts | null> {
  if (!isSupabaseConfigured) return null
  try {
    const res = await q
    if (res.error) return null
    const p = row.safeParse(res.data)
    return p.success ? (p.data?.address_parts ?? null) : null
  } catch { return null }
}

async function write(q: PromiseLike<Res>, expectRow = true): Promise<void> {
  if (!isSupabaseConfigured) throw backendUnavailable()
  let res: Res
  try { res = await q } catch (e) { throw mapPostgrestError({ message: e instanceof Error ? e.message : String(e) }) }
  if (res.error) {
    // banco sem a 0042: coluna/função ainda não existe
    if (res.error.code === 'PGRST204' || res.error.code === '42703') throw outdatedSchema(res.error)
    if (res.error.code === '23514') throw new RepositoryError('validation', 'Endereço incompleto ou inválido. Confira o CEP, a rua, o número e o bairro.')
    throw mapPostgrestError(res.error)
  }
  if (expectRow && Array.isArray(res.data) && res.data.length === 0) throw new RepositoryError('forbidden', 'Você não tem permissão para alterar este endereço.')
}

export const getBusinessAddress = (businessId: string) => read(supabase.from('businesses').select('address_parts').eq('id', businessId).maybeSingle())
export const saveBusinessAddress = (businessId: string, a: AddressParts) =>
  write(supabase.from('businesses').update({ address_parts: toStoredParts(a) }).eq('id', businessId).select('id'))

export const getMyAddress = (userId: string) => read(supabase.from('profiles').select('address_parts').eq('id', userId).maybeSingle())
export const saveMyAddress = (userId: string, a: AddressParts) =>
  write(supabase.from('profiles').update({ address_parts: toStoredParts(a) }).eq('id', userId).select('id'))

export const getCourierAddress = (userId: string) => read(supabase.from('couriers').select('address_parts').eq('user_id', userId).maybeSingle())
export const saveCourierAddress = (a: AddressParts) => write(supabase.rpc('courier_set_address', { _parts: toStoredParts(a) }), false)
