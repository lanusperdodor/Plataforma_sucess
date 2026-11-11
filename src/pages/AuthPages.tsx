import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Card, Field, Notice } from '../components/ui.tsx'
import { isSupabaseConfigured, supabase } from '../lib/supabase.ts'
import { homeFor } from '../features/permissions/permissions.ts'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import {
  loginSchema,
  newPasswordSchema,
  resetSchema,
  signUpSchema,
  type LoginValues,
  type NewPasswordValues,
  type ResetValues,
  type SignUpValues,
} from '../features/auth/schemas.ts'
import { SIGN_IN_MESSAGES, signInWithGoogle, signInWithIdentifier } from '../features/auth/signIn.ts'
import { trackLogin, trackSignUp } from '../features/tracking/tracker.ts'

/** Prévia sem Supabase: o formulário funciona visualmente, mas não autentica. */
export const OFFLINE_MESSAGE = 'Entrar e criar conta não funcionam nesta prévia, que não se conecta ao banco. Use o site publicado.'

function ConfigWarning() {
  if (isSupabaseConfigured) return null
  return (
    <Notice kind="info">
      {import.meta.env.VITE_STATIC_PREVIEW === '1' ? (
        'Esta é a prévia: entrar e criar conta só funcionam no site publicado.'
      ) : (
        <>Supabase não configurado. Copie <code>.env.example</code> para <code>.env.local</code> e preencha.</>
      )}
    </Notice>
  )
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
    </svg>
  )
}

/** Entrar ou criar conta com o Google (OAuth do Supabase). */
export function GoogleButton({ onError }: { onError: (msg: string) => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <>
      <div className="my-4 flex items-center gap-3 text-xs text-ink-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />ou<span className="h-px flex-1 bg-line" />
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (!isSupabaseConfigured) return onError(OFFLINE_MESSAGE)
          setBusy(true)
          const { error } = await signInWithGoogle()
          if (error) {
            setBusy(false)
            onError(error)
          }
        }}
        className="pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink disabled:opacity-50"
      >
        <GoogleIcon />
        {busy ? 'Abrindo o Google…' : 'Continuar com Google'}
      </button>
      <p className="mt-2 text-center text-xs text-ink-muted">
        Ao continuar, você concorda com os <Link className="underline" to="/termos">Termos de uso</Link> e a{' '}
        <Link className="underline" to="/privacidade">Política de privacidade</Link>.
      </p>
    </>
  )
}

/** Aceita só caminhos internos (evita redirecionamento aberto via state manipulado). */
export function safeRedirect(from: unknown, fallback = '/conta'): string {
  if (typeof from !== 'string') return fallback
  // eslint-disable-next-line no-control-regex -- recusa tab/quebra de linha (o navegador os remove e /\t/x vira //x)
  if (/[\u0000-\u001f\u007f]/.test(from)) return fallback
  if (!from.startsWith('/') || from.startsWith('//') || from.includes('\\')) return fallback
  return from
}

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { session, loading, authz, authzError } = useAuth()
  const [error, setError] = useState<string>()
  const f = useForm<LoginValues>({ resolver: zodResolver(loginSchema) })
  const from = (location.state as { from?: unknown } | null)?.from
  // veio de uma página protegida: volta para ela; senão vai para o painel do perfil
  const hasFrom = safeRedirect(from, '') !== ''
  const target = safeRedirect(from)

  const onSubmit = f.handleSubmit(async (v) => {
    setError(undefined)
    if (!isSupabaseConfigured) return setError(OFFLINE_MESSAGE)
    const { error: err } = await signInWithIdentifier(v.identifier, v.password)
    if (err) return setError(SIGN_IN_MESSAGES[err])
    trackLogin(v.identifier.includes('@') ? 'email' : 'username')
    if (hasFrom) navigate(target, { replace: true })
  })

  if (!loading && session) {
    if (hasFrom) return <Navigate to={target} replace />
    if (authz || authzError) return <Navigate to={authz ? homeFor(authz) : '/conta'} replace />
    return <Card title="Entrando…"><p role="status" className="text-sm text-ink-muted">Abrindo o seu painel…</p></Card>
  }

  return (
    <Card title="Entrar" subtitle="Acesse sua conta Tucaí para pedir, acompanhar e interagir.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="E-mail ou usuário" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} error={f.formState.errors.identifier?.message} {...f.register('identifier')} />
        <Field label="Senha" type="password" autoComplete="current-password" error={f.formState.errors.password?.message} {...f.register('password')} />
        <Button type="submit" className="w-full" disabled={f.formState.isSubmitting}>
          {f.formState.isSubmitting ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
      {error && <Notice kind="error">{error}</Notice>}
      <GoogleButton onError={setError} />
      <ConfigWarning />
      <p className="mt-4 flex justify-between text-sm">
        <Link className="text-brand" to="/recuperar-senha">Esqueci a senha</Link>
        <Link className="text-brand" to="/cadastro">Criar conta</Link>
      </p>
    </Card>
  )
}

export function SignUpPage() {
  const navigate = useNavigate()
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string }>()
  const f = useForm<SignUpValues>({ resolver: zodResolver(signUpSchema) })

  const onSubmit = f.handleSubmit(async (v) => {
    setMsg(undefined)
    if (!isSupabaseConfigured) return setMsg({ kind: 'error', text: OFFLINE_MESSAGE })
    const username = v.username?.trim().toLowerCase() || ''
    if (username) {
      const { data: free } = await supabase.rpc('username_available', { _username: username })
      if (free === false) return f.setError('username', { message: 'Este nome de usuário já está em uso ou é reservado.' })
    }
    const { data, error } = await supabase.auth.signUp({
      email: v.email,
      password: v.password,
      options: { data: { full_name: v.fullName, ...(username ? { username } : {}) }, emailRedirectTo: `${window.location.origin}/entrar` },
    })
    if (error) return setMsg({ kind: 'error', text: 'Não foi possível criar a conta. Verifique os dados.' })
    trackSignUp('email')
    // projeto sem confirmação de e-mail: a sessão já vem aberta
    if (data.session) return navigate('/conta', { replace: true })
    setMsg({ kind: 'success', text: 'Conta criada. Confirme seu e-mail para entrar.' })
  })

  return (
    <Card title="Criar conta" subtitle="Leva menos de um minuto. Você começa como cliente.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Nome completo" autoComplete="name" error={f.formState.errors.fullName?.message} {...f.register('fullName')} />
        <Field label="E-mail" type="email" autoComplete="email" error={f.formState.errors.email?.message} {...f.register('email')} />
        <Field label="Nome de usuário (opcional, para entrar sem digitar o e-mail)" autoComplete="username" autoCapitalize="none" spellCheck={false} error={f.formState.errors.username?.message} {...f.register('username')} />
        <Field label="Senha" type="password" autoComplete="new-password" error={f.formState.errors.password?.message} {...f.register('password')} />
        <Button type="submit" className="w-full" disabled={f.formState.isSubmitting}>
          {f.formState.isSubmitting ? 'Criando…' : 'Criar conta'}
        </Button>
      </form>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <GoogleButton onError={(text) => setMsg({ kind: 'error', text })} />
      <ConfigWarning />
      <p className="mt-4 text-sm">
        Já tem conta? <Link className="text-brand" to="/entrar">Entrar</Link>
      </p>
    </Card>
  )
}

export function ResetPasswordPage() {
  const [sent, setSent] = useState(false)
  const [offline, setOffline] = useState(false)
  const f = useForm<ResetValues>({ resolver: zodResolver(resetSchema) })

  const onSubmit = f.handleSubmit(async (v) => {
    if (!isSupabaseConfigured) return setOffline(true)
    await supabase.auth.resetPasswordForEmail(v.email, { redirectTo: `${window.location.origin}/nova-senha` })
    setSent(true) // resposta idêntica exista ou não a conta (evita enumeração de usuários)
  })

  return (
    <Card title="Recuperar senha" subtitle="Enviaremos um link para você definir uma senha nova.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="E-mail" type="email" autoComplete="email" error={f.formState.errors.email?.message} {...f.register('email')} />
        <Button type="submit" className="w-full" disabled={f.formState.isSubmitting}>
          Enviar instruções
        </Button>
      </form>
      {sent && <Notice kind="success">Se o e-mail existir, enviaremos as instruções.</Notice>}
      {offline && <Notice kind="error">{OFFLINE_MESSAGE}</Notice>}
      <ConfigWarning />
    </Card>
  )
}

/** Destino do link de recuperação: o Supabase abre uma sessão de recuperação e aqui se define a senha nova. */
export function NewPasswordPage() {
  const navigate = useNavigate()
  const { loading, session, finishRecovery } = useAuth()
  const [error, setError] = useState<string>()
  const f = useForm<NewPasswordValues>({ resolver: zodResolver(newPasswordSchema) })

  const onSubmit = f.handleSubmit(async (v) => {
    setError(undefined)
    const { error: err } = await supabase.auth.updateUser({ password: v.password })
    if (err) {
      return setError(
        err.code === 'same_password'
          ? 'A nova senha precisa ser diferente da anterior.'
          : 'Não foi possível salvar a senha. Solicite um novo link.',
      )
    }
    finishRecovery()
    navigate('/conta', { replace: true, state: { notice: 'Senha alterada.' } })
  })

  if (loading) return <p className="p-6 text-sm text-ink/70">Carregando…</p>
  if (!session) {
    return (
      <Card title="Definir nova senha">
        <Notice kind="error">Link inválido ou expirado.</Notice>
        <p className="mt-4 text-sm">
          <Link className="text-brand" to="/recuperar-senha">Solicitar novo link</Link>
        </p>
      </Card>
    )
  }

  return (
    <Card title="Definir nova senha">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Nova senha" type="password" autoComplete="new-password" error={f.formState.errors.password?.message} {...f.register('password')} />
        <Field label="Confirme a nova senha" type="password" autoComplete="new-password" error={f.formState.errors.confirm?.message} {...f.register('confirm')} />
        <Button type="submit" className="w-full" disabled={f.formState.isSubmitting}>
          {f.formState.isSubmitting ? 'Salvando…' : 'Salvar senha'}
        </Button>
      </form>
      {error && <Notice kind="error">{error}</Notice>}
    </Card>
  )
}
