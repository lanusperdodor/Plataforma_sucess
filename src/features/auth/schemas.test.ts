import { describe, expect, it } from 'vitest'
import { signUpSchema, loginSchema } from './schemas.ts'

describe('schemas de autenticação', () => {
  it('rejeita senha fraca no cadastro', () => {
    const r = signUpSchema.safeParse({ fullName: 'Ana', email: 'a@b.com', password: 'abc' })
    expect(r.success).toBe(false)
  })
  it('aceita cadastro válido', () => {
    const r = signUpSchema.safeParse({ fullName: 'Ana Souza', email: 'ana@exemplo.com', password: 'senhaForte123' })
    expect(r.success).toBe(true)
  })
  it('rejeita e-mail inválido no login', () => {
    expect(loginSchema.safeParse({ email: 'x', password: '1' }).success).toBe(false)
  })
})
