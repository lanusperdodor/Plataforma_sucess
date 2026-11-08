import { BRAND } from '../config/brand.ts'

/** Horários de funcionamento no fuso America/Sao_Paulo. `closes <= opens` atravessa a meia-noite. */
export interface HoursWindow {
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6
  opens: string
  closes: string
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const DAY = 1440

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    })
    formatters.set(tz, f)
  }
  return f
}

interface FullParts {
  weekday: number
  minutes: number
  year: number
  month: number
  day: number
  /** Relógio local expresso como ms "UTC" (para calcular o deslocamento do fuso). */
  wallMs: number
}

function fullParts(at: Date, tz: string): FullParts {
  const p: Record<string, string> = {}
  for (const part of formatter(tz).formatToParts(at)) p[part.type] = part.value
  const year = Number(p.year)
  const month = Number(p.month)
  const day = Number(p.day)
  const hour = Number(p.hour) % 24
  const minute = Number(p.minute)
  const second = Number(p.second)
  return {
    weekday: WEEKDAYS[p.weekday ?? ''] ?? 0,
    minutes: hour * 60 + minute,
    year,
    month,
    day,
    wallMs: Date.UTC(year, month - 1, day, hour, minute, second),
  }
}

/** Dia da semana (0 = domingo) e minutos desde 00:00 no fuso informado. */
export function localParts(at: Date, tz: string = BRAND.timezone): { weekday: number; minutes: number } {
  const { weekday, minutes } = fullParts(at, tz)
  return { weekday, minutes }
}

/** "HH:MM" ou "HH:MM:SS" (inclui "24:00") em minutos. */
function toMinutes(value: string): number {
  const [h = '0', m = '0'] = value.split(':')
  return Number(h) * 60 + Number(m)
}

export function isOpenNow(hours: readonly HoursWindow[], at: Date): boolean {
  const { weekday, minutes: t } = localParts(at)
  const yesterday = (weekday + 6) % 7
  return hours.some((w) => {
    const opens = toMinutes(w.opens)
    const closes = toMinutes(w.closes)
    const crosses = closes <= opens
    if (w.weekday === weekday) return crosses ? t >= opens : t >= opens && t < closes
    return w.weekday === yesterday && crosses && t < closes
  })
}

/** Instante UTC correspondente a uma data/hora local no fuso. */
function zonedInstant(year: number, month: number, day: number, minutes: number, tz: string): Date {
  const wall = Date.UTC(year, month - 1, day, 0, minutes)
  let guess = wall
  for (let i = 0; i < 2; i++) {
    const offset = fullParts(new Date(guess), tz).wallMs - guess
    guess = wall - offset
  }
  return new Date(guess)
}

/** Próximo instante (estritamente posterior a `at`) em que uma janela abre, ou null. */
export function nextOpening(hours: readonly HoursWindow[], at: Date): Date | null {
  if (hours.length === 0) return null
  const tz = BRAND.timezone
  const now = fullParts(at, tz)
  let best: Date | null = null
  for (let offset = 0; offset <= 7; offset++) {
    const date = new Date(Date.UTC(now.year, now.month - 1, now.day + offset))
    const weekday = date.getUTCDay()
    for (const w of hours) {
      if (w.weekday !== weekday) continue
      const candidate = zonedInstant(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
        Math.min(toMinutes(w.opens), DAY),
        tz,
      )
      if (candidate.getTime() > at.getTime() && (!best || candidate < best)) best = candidate
    }
    if (best) return best
  }
  return best
}
