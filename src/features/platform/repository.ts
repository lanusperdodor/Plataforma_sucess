import { z } from 'zod'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { rpc } from '../../lib/rpc'

/** Modo manutenção global (0030). O bloqueio de verdade é feito no banco; aqui só a tela. */
export type PlatformMode = 'normal' | 'preparando' | 'manutencao'
const statusSchema = z.object({ mode: z.enum(['normal', 'preparando', 'manutencao']), eta: z.string().nullable() })
export type PlatformStatus = z.infer<typeof statusSchema>

/** Público (inclusive visitante). Sem backend ou em erro de rede: considera normal (não trava a navegação). */
export async function getPlatformStatus(): Promise<PlatformStatus> {
  if (!isSupabaseConfigured) return { mode: 'normal', eta: null }
  const { data, error } = await supabase.rpc('platform_status')
  if (error) return { mode: 'normal', eta: null }
  const parsed = statusSchema.safeParse(data)
  return parsed.success ? parsed.data : { mode: 'normal', eta: null }
}

const counts = z.record(z.string(), z.number())
const adminStatusSchema = z.object({
  mode: z.enum(['normal', 'preparando', 'manutencao']), reason: z.string().nullable(), eta: z.string().nullable(),
  changed_at: z.string().nullable(), changed_by: z.string().nullable(), prepared_at: z.string().nullable(), started_at: z.string().nullable(),
  em_andamento: counts, integridade: counts, mfa: z.boolean(),
})
export type MaintenanceStatus = z.infer<typeof adminStatusSchema>
export const getMaintenanceStatus = () => rpc('admin_maintenance_status', undefined, adminStatusSchema)
export const setMaintenance = (mode: PlatformMode, reason: string, eta: string | null, confirm: string) =>
  rpc('admin_set_maintenance', { _mode: mode, _reason: reason || null, _eta: eta, _confirm: confirm },
    z.object({ mode: z.string(), em_andamento: counts, integridade: counts }))

/** Erro de gravação recusada pela manutenção (mensagem do gatilho no banco). */
export const isMaintenanceError = (e: unknown) => e instanceof Error && /em manutenção/i.test(e.message)
