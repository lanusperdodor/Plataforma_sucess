import { ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, Navigate } from 'react-router-dom'
import { Button, Card, Field, Notice } from '../components/ui.tsx'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import { loginSchema, type LoginValues } from '../features/auth/schemas.ts'
import { isSupabaseConfigured, signInWithPassword } from '../features/auth/signIn.ts'
import { OFFLINE_MESSAGE } from './AuthPages.tsx'

const ADMIN_ROLES = ['platform_master', 'platform_operator'] as const

/**
 * Login da administração. Usa o MESMO Supabase Auth do cliente: não existe senha administrativa
 * nem atalho. O acesso só é reconhecido se o banco devolver o papel master/operador (RLS decide).
 * Reconhecido o papel, segue para o Painel Master (/admin), que valida tudo de novo no servidor,
 * inclusive MFA quando exigido.
 */
export function AdminLoginPage() {
  const { session, authz, loading, authzError, signOut } = useAuth()
  const [error, setError] = useState<string>()
  const f = useForm<LoginValues>({ resolver: zodResolver(loginSchema) })
  const isAdmin = !!authz?.roles.some((r) => (ADMIN_ROLES as readonly string[]).includes(r))

  const onSubmit = f.handleSubmit(async (v) => {
    setError(undefined)
    if (!isSupabaseConfigured) return setError(OFFLINE_MESSAGE)
    const { error: err } = await signInWithPassword(v.email, v.password)
    if (err) setError('E-mail ou senha incorretos.')
  })

  const header = (
    <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-surface">
      <ShieldCheck aria-hidden="true" className="size-4 text-orange" />
      Área restrita · Administração
    </p>
  )

  if (session && !loading) {
    return (
      <Card title="Administração">
        {header}
        {authzError ? (
          <Notice kind="error">Não foi possível verificar suas permissões. Tente novamente.</Notice>
        ) : isAdmin ? (
          <Navigate to="/admin" replace />
        ) : (
          <Notice kind="error">Esta conta não tem permissão de administração.</Notice>
        )}
        <Button variant="ghost" className="mt-4 w-full" onClick={() => void signOut()}>
          Sair desta conta
        </Button>
      </Card>
    )
  }

  return (
    <Card title="Entrar na administração" subtitle="Acesso exclusivo da equipe Tucaí. Ações administrativas são registradas em auditoria.">
      {header}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="E-mail corporativo" type="email" autoComplete="username" error={f.formState.errors.email?.message} {...f.register('email')} />
        <Field label="Senha" type="password" autoComplete="current-password" error={f.formState.errors.password?.message} {...f.register('password')} />
        <Button type="submit" className="w-full" disabled={f.formState.isSubmitting}>
          {f.formState.isSubmitting ? 'Verificando…' : 'Entrar'}
        </Button>
      </form>
      {error && <Notice kind="error">{error}</Notice>}
      <p className="mt-4 text-xs text-ink-muted">
        A verificação em duas etapas (MFA) é configurada no painel, em Segurança.
      </p>
      <p className="mt-4 flex justify-between text-sm">
        <Link className="text-brand" to="/recuperar-senha">Esqueci a senha</Link>
        <Link className="text-brand" to="/entrar">Sou cliente</Link>
      </p>
    </Card>
  )
}