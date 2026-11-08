export type ParamValue = string | number | boolean | null | undefined

export function getString(params: URLSearchParams, key: string): string | undefined {
  const v = params.get(key)
  return v === null || v === '' ? undefined : v
}

export function getNumber(params: URLSearchParams, key: string): number | undefined {
  const v = getString(params, key)
  if (v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function getBoolean(params: URLSearchParams, key: string): boolean | undefined {
  const v = params.get(key)
  if (v === 'true' || v === '1') return true
  if (v === 'false' || v === '0') return false
  return undefined
}

export function getList(params: URLSearchParams, key: string): string[] {
  return params.getAll(key).flatMap((v) => v.split(',')).filter((v) => v !== '')
}

export function getEnum<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const v = params.get(key)
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : undefined
}

/** Devolve novos parâmetros; null/undefined/'' removem a chave, arrays viram valores repetidos. */
export function setParams(
  params: URLSearchParams,
  updates: Record<string, ParamValue | readonly string[]>,
): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const [key, value] of Object.entries(updates)) {
    next.delete(key)
    if (Array.isArray(value)) {
      for (const item of value) next.append(key, item)
    } else if (value !== null && value !== undefined && value !== '') {
      next.set(key, String(value))
    }
  }
  return next
}
