/** Tamanho de página padrão das listagens. */
export const PAGE_SIZE = 12

export interface Page<T> {
  items: T[]
  hasMore: boolean
  /** Próxima página (base 0) ou null quando não há mais itens. */
  nextPage: number | null
}

/**
 * Intervalo (inclusivo, como `range` do PostgREST) que pede `size + 1` linhas,
 * para descobrir `hasMore` sem uma consulta de contagem.
 * Ex.: pageRange(0, 12) -> { from: 0, to: 12 } (13 linhas).
 */
export function pageRange(page: number, size: number = PAGE_SIZE): { from: number; to: number } {
  const p = Number.isInteger(page) && page > 0 ? page : 0
  const from = p * size
  return { from, to: from + size }
}

/** Converte as linhas (até size + 1) em uma página. */
export function toPage<T>(rows: readonly T[], size: number = PAGE_SIZE, page = 0): Page<T> {
  const hasMore = rows.length > size
  return {
    items: rows.slice(0, size),
    hasMore,
    nextPage: hasMore ? page + 1 : null,
  }
}
