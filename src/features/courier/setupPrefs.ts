import { z } from 'zod'
import { readStorage, writeStorage } from '../../lib/storage'

/** O que o entregador escolheu no pop-up "Ficar online" (fica só neste aparelho). */
export const COURIER_PREFS_KEY = 'tucai:entregador-preferencias'
const schema = z.object({ sound: z.boolean(), gps: z.boolean(), awake: z.boolean(), push: z.boolean() })
export type CourierPrefs = z.infer<typeof schema>
export const DEFAULT_PREFS: CourierPrefs = { sound: true, gps: true, awake: true, push: true }

export function readCourierPrefs(): CourierPrefs | null {
  return readStorage(COURIER_PREFS_KEY, schema)
}
export function saveCourierPrefs(p: CourierPrefs): void {
  writeStorage(COURIER_PREFS_KEY, p)
}
