/** Valores monetários são sempre centavos inteiros BRL. Único ponto de formatação. */

export function assertCents(n: number, name = 'valor'): number {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`${name} deve ser um inteiro não negativo (centavos)`)
  }
  return n
}

/** 123456 -> "R$ 1.234,56" (espaço comum, determinístico entre ambientes). */
export function formatBRL(cents: number): string {
  assertCents(cents, 'cents')
  const reais = Math.floor(cents / 100)
  const rest = String(cents % 100).padStart(2, '0')
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `R$ ${grouped},${rest}`
}

/** Inverso de formatBRL. Aceita "R$ 1.234,56", "1234,56", "12" e "12,5". Devolve centavos. */
export function parseBRL(text: string): number {
  const clean = text.replace(/R\$/g, '').replace(/[\s\u00a0]/g, '')
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(clean)) {
    throw new RangeError(`Valor monetário inválido: "${text}"`)
  }
  const [intPart = '0', decPart = ''] = clean.replace(/\./g, '').split(',')
  return assertCents(Number(intPart) * 100 + Number(decPart.padEnd(2, '0')), 'valor')
}
