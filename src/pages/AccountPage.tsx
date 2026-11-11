import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Card, Field, Notice } from '../components/ui.tsx'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import { USERNAME_RE, profileSchema, type ProfileValues } from '../features/auth/schemas.ts'
import { supabase } from '../lib/supabase.ts'

type Msg = { kind: 'error' | 'success'; text: string }

/** Nome de usuário para entrar sem digitar o e-mail (gravado pelo servidor, que valida e evita duplicados). */
function UsernameForm({ userId }: { userId: string }) {
  const [value, setValue] = useState('')
  const [current, setCurrent] = useState<string | null>(null)
  const [msg, setMsg] = useState<Msg>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    supabase
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (!active || !data) return
        const u = (data as { username?: string | null }).username ?? null
        setCurrent(u)
        setValue(u ?? '')
      })
    return () => {
      active = false
    }
  }, [userId])
  const save = async () => {
    setMsg(undefined)
    if (value.trim() && !USERNAME_RE.test(value.trim())) return setMsg({ kind: 'error', text: 'Use de 3 a 30 letras, números, ponto ou sublinhado.' })
    setBusy(true)
    const { data, error } = await supabase.rpc('set_my_username', { _username: value.trim() })
    setBusy(false)
    if (error) return setMsg({ kind: 'error', text: error.message || 'Não foi possível salvar.' })
    setCurrent((data as string | null) ?? null)
    setMsg({ kind: 'success', text: data ? `Pronto: você pode entrar com o usuário ${data as string}.` : 'Nome de usuário removido.' })
  }
  return (
    <form
      className="mt-6 space-y-3 border-t border-line pt-4"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      noValidate
    >
      <Field
        label="Nome de usuário (para entrar sem o e-mail)"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <p className="text-xs text-ink/70">
        {current ? `Atual: ${current}. ` : ''}Não diferencia maiúsculas de minúsculas e não aparece para outras pessoas.
      </p>
      <Button type="submit" variant="ghost" className="w-full" disabled={busy}>{busy ? 'Salvando…' : 'Salvar usuário'}</Button>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    </form>
  )
}

/** Troca da própria senha (o Supabase exige a sessão atual; nada passa pelo nosso banco). */
function PasswordForm() {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState<Msg>()
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setMsg(undefined)
    if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return setMsg({ kind: 'error', text: 'Use pelo menos 8 caracteres, com letras e números.' })
    if (pw !== confirm) return setMsg({ kind: 'error', text: 'As senhas não conferem.' })
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return setMsg({ kind: 'error', text: /reauth|recent/i.test(error.message) ? 'Por segurança, saia e entre de novo antes de trocar a senha.' : error.message || 'Não foi possível trocar a senha.' })
    setPw('')
    setConfirm('')
    setMsg({ kind: 'success', text: 'Senha alterada. Use a nova senha no próximo login.' })
  }
  return (
    <form
      className="mt-6 space-y-3 border-t border-line pt-4"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      noValidate
    >
      <h2 className="text-sm font-semibold text-ink">Alterar senha</h2>
      <Field label="Nova senha" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      <Field label="Repita a nova senha" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <Button type="submit" variant="ghost" className="w-full" disabled={busy}>{busy ? 'Salvando…' : 'Alterar senha'}</Button>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <p className="text-xs text-ink/70">Não conseguiu trocar a senha ou o usuário? Fale com o suporte da Tucaí, que faz a alteração para você.</p>
    </form>
  )
}

export function AccountPage() {
  const { session, authz, authzError, signOut } = useAuth()
  const location = useLocation()
  const initialNotice = (location.state as { notice?: unknown } | null)?.notice
  const [msg, setMsg] = useState<Msg | undefined>(
    typeof initialNotice === 'string' ? { kind: 'success', text: initialNotice } : undefined,
  )
  const [loadFailed, setLoadFailed] = useState(false)
  const f = useForm<ProfileValues>({ resolver: zodResolver(profileSchema) })
  const userId = session?.user.id
  const reset = f.reset

  useEffect(() => {
    if (!userId) return
    let active = true
    supabase
      .from('profiles')
      .select('full_name, phone')
      .eq('id', userId)
      .single()
      .then(({ data, error }) => {
        if (!active) return // troca de usuário/desmontagem: descarta resposta antiga
        if (error || !data) return setLoadFailed(true)
        setLoadFailed(false)
        reset({ fullName: data.full_name ?? '', phone: data.phone ?? '' })
      })
    return () => {
      active = false
    }
  }, [userId, reset])

  const onSubmit = f.handleSubmit(async (v) => {
    if (!userId) return
    const { data, error } = await supabase
      .from('profiles')
      .update({ full_name: v.fullName, phone: v.phone || null })
      .eq('id', userId)
      .select('id')
    // RLS que bloqueia retorna 0 linhas sem erro: tratar como falha
    const ok = !error && (data?.length ?? 0) === 1
    setMsg(ok ? { kind: 'success', text: 'Perfil salvo.' } : { kind: 'error', text: 'Não foi possível salvar.' })
  })

  const onSignOut = async () => {
    const { error } = await signOut()
    if (error) setMsg({ kind: 'error', text: 'Não foi possível sair. Tente novamente.' })
  }

  const roles = authzError ? 'não foi possível carregar' : authz?.roles.join(', ') || '—'

  return (
    <Card title="Minha conta">
      <p className="mb-4 text-sm text-ink/70">
        {session?.user.email} · Papéis: {roles}
      </p>
      {loadFailed && <Notice kind="error">Não foi possível carregar seu perfil.</Notice>}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Nome completo" autoComplete="name" error={f.formState.errors.fullName?.message} {...f.register('fullName')} />
        <Field label="Telefone" type="tel" autoComplete="tel" error={f.formState.errors.phone?.message} {...f.register('phone')} />
        <Button type="submit" className="w-full" disabled={f.formState.isSubmitting || loadFailed}>Salvar</Button>
      </form>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {userId && <UsernameForm userId={userId} />}
      {userId && <PasswordForm />}
      <Button variant="ghost" className="mt-4 w-full" onClick={() => void onSignOut()}>Sair</Button>
    </Card>
  )
}
