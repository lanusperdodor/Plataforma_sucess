import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Card, Field, Notice } from '../components/ui.tsx'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import { profileSchema, type ProfileValues } from '../features/auth/schemas.ts'
import { supabase } from '../lib/supabase.ts'

type Msg = { kind: 'error' | 'success'; text: string }

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
      <Button variant="ghost" className="mt-4 w-full" onClick={() => void onSignOut()}>Sair</Button>
    </Card>
  )
}
