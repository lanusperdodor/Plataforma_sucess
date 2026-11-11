/**
 * Cliente Supabase simulado para testes (sem rede, sem mocks de dados).
 * Cada consulta encadeada é registrada em `queries` e resolvida pelo `handler`.
 * Uso típico:
 *   const fake = createFakeSupabase((q) => ({ data: [...], error: null }))
 *   vi.mock('../lib/supabase.ts', () => ({ isSupabaseConfigured: true, supabase: fake.supabase }))
 */

export type FakeOp = 'select' | 'insert' | 'update' | 'delete' | 'upsert' | 'rpc'

export type FakeFilter =
  | { kind: 'eq'; column: string; value: unknown }
  | { kind: 'in'; column: string; value: readonly unknown[] }
  | { kind: 'gte'; column: string; value: unknown }
  | { kind: 'lte'; column: string; value: unknown }
  | { kind: 'lt'; column: string; value: unknown }
  | { kind: 'is'; column: string; value: unknown }
  | { kind: 'ilike'; column: string; value: string }
  | { kind: 'or'; expression: string }

export interface FakeQuery {
  /** Nome da tabela, ou da função quando `op` é `rpc`. */
  table: string
  op: FakeOp
  /** Colunas do último `select(...)`; '*' por padrão. */
  columns: string
  filters: FakeFilter[]
  /** Atalho: valores de filtros `eq` por coluna. */
  eq: Record<string, unknown>
  order: { column: string; ascending: boolean }[]
  range?: { from: number; to: number }
  limit?: number
  /** `single` exige 1 linha; `maybeSingle` aceita 0 ou 1. */
  single?: 'single' | 'maybeSingle'
  /** Corpo de insert/update/upsert ou argumentos do rpc. */
  payload?: unknown
  options?: unknown
}

export interface FakeResult {
  data: unknown
  error: unknown
  count?: number | null
}

export type FakeHandler = (q: FakeQuery) => Promise<FakeResult> | FakeResult

export interface FakeBuilder extends PromiseLike<FakeResult> {
  select(columns?: string, options?: unknown): FakeBuilder
  insert(payload: unknown, options?: unknown): FakeBuilder
  update(payload: unknown, options?: unknown): FakeBuilder
  upsert(payload: unknown, options?: unknown): FakeBuilder
  delete(): FakeBuilder
  eq(column: string, value: unknown): FakeBuilder
  in(column: string, value: readonly unknown[]): FakeBuilder
  gte(column: string, value: unknown): FakeBuilder
  lte(column: string, value: unknown): FakeBuilder
  lt(column: string, value: unknown): FakeBuilder
  is(column: string, value: unknown): FakeBuilder
  ilike(column: string, value: string): FakeBuilder
  or(expression: string): FakeBuilder
  order(column: string, options?: { ascending?: boolean }): FakeBuilder
  range(from: number, to: number): FakeBuilder
  limit(count: number): FakeBuilder
  single(): FakeBuilder
  maybeSingle(): FakeBuilder
}

export interface FakeAuth {
  /** Último ouvinte registrado por `onAuthStateChange`. */
  listener: null | ((event: string, session: unknown) => void)
  session: unknown
  onAuthStateChange(cb: (event: string, session: unknown) => void): {
    data: { subscription: { unsubscribe: () => void } }
  }
  getSession(): Promise<{ data: { session: unknown }; error: null }>
  getUser(): Promise<{ data: { user: unknown }; error: null }>
  signInWithPassword(creds: unknown): Promise<{ data: unknown; error: unknown }>
  signUp(creds: unknown): Promise<{ data: unknown; error: unknown }>
  signOut(opts?: unknown): Promise<{ error: unknown }>
  resetPasswordForEmail(email: string, opts?: unknown): Promise<{ data: unknown; error: unknown }>
  updateUser(attrs: unknown): Promise<{ data: unknown; error: unknown }>
  /** Auxiliar de teste: dispara um evento de sessão no ouvinte. */
  emit(event: string, session: unknown): void
}

export interface FakeSupabase {
  supabase: {
    auth: FakeAuth
    from(table: string): FakeBuilder
    rpc(fn: string, args?: unknown, options?: unknown): FakeBuilder
  }
  /** Todas as consultas executadas, em ordem. */
  queries: FakeQuery[]
  /** Substitua para controlar as respostas. Padrão: lista vazia sem erro. */
  handler: FakeHandler
  /** Limpa o registro de consultas e a sessão. */
  reset(): void
}

export function createFakeSupabase(initial?: FakeHandler): FakeSupabase {
  const state: FakeSupabase = {
    queries: [],
    handler: initial ?? (() => ({ data: [], error: null })),
    reset() {
      state.queries.length = 0
      state.supabase.auth.session = null
      state.supabase.auth.listener = null
    },
    supabase: undefined as unknown as FakeSupabase['supabase'],
  }

  const newQuery = (table: string, op: FakeOp): FakeQuery => ({
    table,
    op,
    columns: '*',
    filters: [],
    eq: {},
    order: [],
  })

  const makeBuilder = (q: FakeQuery): FakeBuilder => {
    const b: FakeBuilder = {
      select(columns = '*', options) {
        // Em insert/update/upsert/delete, select() só pede retorno das linhas.
        if (q.op === 'select' || q.op === 'rpc') q.options = options
        q.columns = columns
        return b
      },
      insert(payload, options) {
        q.op = 'insert'
        q.payload = payload
        q.options = options
        return b
      },
      update(payload, options) {
        q.op = 'update'
        q.payload = payload
        q.options = options
        return b
      },
      upsert(payload, options) {
        q.op = 'upsert'
        q.payload = payload
        q.options = options
        return b
      },
      delete() {
        q.op = 'delete'
        return b
      },
      eq(column, value) {
        q.filters.push({ kind: 'eq', column, value })
        q.eq[column] = value
        return b
      },
      in(column, value) {
        q.filters.push({ kind: 'in', column, value })
        return b
      },
      gte(column, value) {
        q.filters.push({ kind: 'gte', column, value })
        return b
      },
      lt(column, value) {
        q.filters.push({ kind: 'lt', column, value })
        return b
      },
      is(column, value) {
        q.filters.push({ kind: 'is', column, value })
        return b
      },
      lte(column, value) {
        q.filters.push({ kind: 'lte', column, value })
        return b
      },
      ilike(column, value) {
        q.filters.push({ kind: 'ilike', column, value })
        return b
      },
      or(expression) {
        q.filters.push({ kind: 'or', expression })
        return b
      },
      order(column, options) {
        q.order.push({ column, ascending: options?.ascending ?? true })
        return b
      },
      range(from, to) {
        q.range = { from, to }
        return b
      },
      limit(count) {
        q.limit = count
        return b
      },
      single() {
        q.single = 'single'
        return b
      },
      maybeSingle() {
        q.single = 'maybeSingle'
        return b
      },
      then(onfulfilled, onrejected) {
        state.queries.push(q)
        return Promise.resolve(state.handler(q)).then(onfulfilled, onrejected)
      },
    }
    return b
  }

  const auth: FakeAuth = {
    listener: null,
    session: null,
    onAuthStateChange(cb) {
      auth.listener = cb
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              auth.listener = null
            },
          },
        },
      }
    },
    getSession: () => Promise.resolve({ data: { session: auth.session }, error: null }),
    getUser: () =>
      Promise.resolve({
        data: { user: (auth.session as { user?: unknown } | null)?.user ?? null },
        error: null,
      }),
    signInWithPassword: () => Promise.resolve({ data: {}, error: null }),
    signUp: () => Promise.resolve({ data: { session: null }, error: null }),
    signOut: () => Promise.resolve({ error: null }),
    resetPasswordForEmail: () => Promise.resolve({ data: {}, error: null }),
    updateUser: () => Promise.resolve({ data: {}, error: null }),
    emit(event, session) {
      auth.session = session
      auth.listener?.(event, session)
    },
  }

  state.supabase = {
    auth,
    from: (table) => makeBuilder(newQuery(table, 'select')),
    rpc: (fn, args, options) => {
      const q = newQuery(fn, 'rpc')
      q.payload = args
      q.options = options
      return makeBuilder(q)
    },
  }
  return state
}
