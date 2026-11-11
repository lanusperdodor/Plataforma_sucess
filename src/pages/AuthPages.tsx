import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Card, Field, Notice } from '../components/ui.tsx'
import { isSupabaseConfigured, supabase } from '../lib/supabase.ts'
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
  const { session, loading } = useAuth()
  const [error, setError] = useState<string>()
  const f = useForm<LoginValues>({ resolver: zodResolver(loginSchema) })
  const target = safeRedirect((location.state as { from?: unknown } | null)?.from)

  const onSubmit = f.handleSubmit(async (v) => {
    setError(undefined)
    if (!isSupabaseConfigured) return setError(OFFLINE_MESSAGE)
    const { error: err } = await supabase.auth.signInWithPassword(v)
    if (err) {
      return setError(
        err.code === 'email_not_confirmed'
          ? 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.'
          : 'E-mail ou senha incorretos.',
      )
    }
    navigate(target, { replace: true })
  })

  if (!loading && session) return <Navigate to={target} replace />

  return (
    <Card title="Entrar" subtitle="Acesse sua conta Tucaí para pedir, acompanhar e interagir.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="E-mail" type="email" autoComplete="email" error={f.formState.errors.email?.message} {...f.register('email')} />
        <Field label="Senha" type="password" autoComplete="current-password" error={f.formState.errors.password?.message} {...f.register('password')} />
        <Button type="submit" className="w-full" disabled={f.formState.isSubmitting}>
          {f.formState.isSubmitting ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
      {error && <Notice kind="error">{error}</Notice>}
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
    const { data, error } = await supabase.auth.signUp({
      email: v.email,
      password: v.password,
      options: { data: { full_name: v.fullName }, emailRedirectTo: `${window.location.origin}/entrar` },
    })
    if (error) return setMsg({ kind: 'error', text: 'Não foi possível criar a conta. Verifique os dados.' })
    // projeto sem confirmação de e-mail: a sessão já vem aberta
    if (data.session) return navigate('/conta', { replace: true })
    setMsg({ kind: 'success', text: 'Conta criada. Confirme seu e-mail para entrar.' })
  })

  return (
    <Card title="Criar conta" subtitle="Leva menos de um minuto. Você começa como cliente.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Nome completo" autoComplete="name" error={f.formState.errors.fullName?.message} {...f.register('fullName')} />
        <Field label="E-mail" type="email" autoComplete="email" error={f.formState.errors.email?.message} {...f.register('email')} />
        <Field label="Senha" type="password" autoComplete="new-password" error={f.formState.errors.password?.message} {...f.register('password')} />
        <Button type="submit" className="w-full" disabled={f.formState.isSubmitting}>
          {f.formState.isSubmitting ? 'Criando…' : 'Criar conta'}
        </Button>
      </form>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
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
