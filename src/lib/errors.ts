export type RepositoryErrorCode =
  | 'network'
  | 'not_found'
  | 'forbidden'
  | 'validation'
  | 'conflict'
  | 'business_rule'
  | 'unavailable'
  | 'rate_limited'
  | 'unknown'

export class RepositoryError extends Error {
  constructor(
    public code: RepositoryErrorCode,
    message: string, // pt-BR, pronta para exibir
    public detail?: { itemId?: string; field?: string },
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'RepositoryError'
  }
}

/** Tabela/visão/função inexistente: migrations ainda não aplicadas no projeto Supabase. */
const MISSING_SCHEMA_CODES = new Set(['PGRST205', 'PGRST202', '42P01', '42883'])

export const UNAVAILABLE_MESSAGE =
  'Não foi possível acessar este recurso no banco de dados da Tucaí agora. Tente novamente em instantes.'

export function backendUnavailable(cause?: unknown): RepositoryError {
  return new RepositoryError('unavailable', UNAVAILABLE_MESSAGE, undefined, { cause })
}

const FETCH_FAILURE = /failed to fetch|networkerror|network request failed|load failed|fetch failed/i

export function mapPostgrestError(e: { code?: string; message: string; details?: string }): RepositoryError {
  const opts = { cause: e }
  if (e.code && MISSING_SCHEMA_CODES.has(e.code)) return backendUnavailable(e)
  switch (e.code) {
    case '42501':
      return new RepositoryError('forbidden', 'Você não tem permissão para esta ação.', undefined, opts)
    case 'PGRST116':
      return new RepositoryError('not_found', 'Não encontrado.', undefined, opts)
    case '23505':
      return new RepositoryError('conflict', 'Este registro já existe ou foi alterado.', undefined, opts)
    case 'PT429':
      return new RepositoryError(
        'rate_limited',
        e.message?.trim() || 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.',
        undefined,
        opts,
      )
    case 'P0001':
      return new RepositoryError(
        'business_rule',
        e.message?.trim() || 'Não foi possível concluir a operação.',
        undefined,
        opts,
      )
  }
  if (FETCH_FAILURE.test(e.message ?? '')) {
    return new RepositoryError('network', 'Sem conexão. Tente novamente.', undefined, opts)
  }
  return new RepositoryError('unknown', 'Algo deu errado. Tente novamente.', undefined, opts)
}
