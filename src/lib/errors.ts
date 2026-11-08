export type RepositoryErrorCode =
  | 'network'
  | 'not_found'
  | 'forbidden'
  | 'validation'
  | 'conflict'
  | 'business_rule'
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

const FETCH_FAILURE = /failed to fetch|networkerror|network request failed|load failed|fetch failed/i

export function mapPostgrestError(e: { code?: string; message: string; details?: string }): RepositoryError {
  const opts = { cause: e }
  switch (e.code) {
    case '42501':
      return new RepositoryError('forbidden', 'Você não tem permissão para esta ação.', undefined, opts)
    case 'PGRST116':
      return new RepositoryError('not_found', 'Não encontrado.', undefined, opts)
    case '23505':
      return new RepositoryError('conflict', 'Este registro já existe ou foi alterado.', undefined, opts)
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
