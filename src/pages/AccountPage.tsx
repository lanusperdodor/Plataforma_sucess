import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Card, Field, Notice } from '../components/ui.tsx'
import { useAuth } from '../features/auth/AuthProvider.tsx'
import { profileSchema, type ProfileValues } from '../features/auth/schemas.ts'
import { supabase } from '../lib/supabase.ts'

export function AccountPage() {
  const { session, authz, signOut } = useAuth()
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string }>()
  const f = useForm<ProfileValues>({ resolver: zodResolver(profileSchema) })
  const userId = session?.user.id
  const reset = f.reset

  useEffect(() => {
    if (!userId) return
    supabase
      .from('profiles')
      .select('full_name, phone')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (data) reset({ fullName: data.full_name ?? '', phone: data.phone ?? '' })
      })
  }, [userId, reset])

  const onSubmit = f.handleSubmit(async (v) => {
    if (!userId) return
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: v.fullName, phone: v.phone || null })
      .eq('id', userId)
    setMsg(error ? { kind: 'error', text: 'Não foi possível salvar.' } : { kind: 'success', text: 'Perfil salvo.' })
  })

  return (
    <Card title="Minha conta">
      <p className="mb-4 text-sm text-ink/70">
        {session?.user.email} · Papéis: {authz?.roles.join(', ') || '—'}
      </p>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Nome completo" error={f.formState.errors.fullName?.message} {...f.register('fullName')} />
        <Field label="Telefone" type="tel" error={f.formState.errors.phone?.message} {...f.register('phone')} />
        <Button type="submit" className="w-full" disabled={f.formState.isSubmitting}>Salvar</Button>
      </form>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <Button variant="ghost" className="mt-4 w-full" onClick={() => void signOut()}>Sair</Button>
    </Card>
  )
}
