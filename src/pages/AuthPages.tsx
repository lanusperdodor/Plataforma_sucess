import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Card, Field, Notice } from '../components/ui.tsx'
import { isSupabaseConfigured, supabase } from '../lib/supabase.ts'
import {
  loginSchema,
  resetSchema,
  signUpSchema,
  type LoginValues,
  type ResetValues,
  type SignUpValues,
} from '../features/auth/schemas.ts'

function ConfigWarning() {
  if (isSupabaseConfigured) return null
  return (
    <Notice kind="info">
      Supabase não configurado. Copie <code>.env.example</code> para <code>.env.local</code> e preencha.
    </Notice>
  )
}

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState<string>()
  const f = useForm<LoginValues>({ resolver: zodResolver(loginSchema) })

  const onSubmit = f.handleSubmit(async (v) => {
    setError(undefined)
    const { error: err } = await supabase.auth.signInWithPassword(v)
    if (err) return setError('E-mail ou senha incorretos.')
    navigate((location.state as { from?: string } | null)?.from ?? '/conta', { replace: true })
  })

  return (
    <Card title="Entrar">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="E-mail" type="email" autoComplete="email" error={f.formState.errors.email?.message} {...f.register('email')} />
        <Field label="Senha" type="password" autoComplete="current-password" error={f.formState.errors.password?.message} {...f.register('password')} />
        <Button type="submit" className="w-full" disabled={f.formState.isSubmitting || !isSupabaseConfigured}>
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
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string }>()
  const f = useForm<SignUpValues>({ resolver: zodResolver(signUpSchema) })

  const onSubmit = f.handleSubmit(async (v) => {
    setMsg(undefined)
    const { error } = await supabase.auth.signUp({
      email: v.email,
      password: v.password,
      options: { data: { full_name: v.fullName }, emailRedirectTo: `${window.location.origin}/entrar` },
    })
    if (error) return setMsg({ kind: 'error', text: 'Não foi possível criar a conta. Verifique os dados.' })
    setMsg({ kind: 'success', text: 'Conta criada. Confirme seu e-mail para entrar.' })
  })

  return (
    <Card title="Criar conta">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Nome completo" autoComplete="name" error={f.formState.errors.fullName?.message} {...f.register('fullName')} />
        <Field label="E-mail" type="email" autoComplete="email" error={f.formState.errors.email?.message} {...f.register('email')} />
        <Field label="Senha" type="password" autoComplete="new-password" error={f.formState.errors.password?.message} {...f.register('password')} />
        <Button type="submit" className="w-full" disabled={f.formState.isSubmitting || !isSupabaseConfigured}>
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
  const f = useForm<ResetValues>({ resolver: zodResolver(resetSchema) })

  const onSubmit = f.handleSubmit(async (v) => {
    await supabase.auth.resetPasswordForEmail(v.email, { redirectTo: `${window.location.origin}/entrar` })
    setSent(true) // resposta idêntica exista ou não a conta (evita enumeração de usuários)
  })

  return (
    <Card title="Recuperar senha">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="E-mail" type="email" autoComplete="email" error={f.formState.errors.email?.message} {...f.register('email')} />
        <Button type="submit" className="w-full" disabled={f.formState.isSubmitting || !isSupabaseConfigured}>
          Enviar instruções
        </Button>
      </form>
      {sent && <Notice kind="success">Se o e-mail existir, enviaremos as instruções.</Notice>}
      <ConfigWarning />
    </Card>
  )
}
