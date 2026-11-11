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
  it('login aceita e-mail ou usuário e rejeita formatos inválidos', () => {
    expect(loginSchema.safeParse({ identifier: 'x@', password: '1' }).success).toBe(false)
    expect(loginSchema.safeParse({ identifier: 'a b', password: '1' }).success).toBe(false)
    expect(loginSchema.safeParse({ identifier: 'ADMIN', password: '1' }).success).toBe(true)
    expect(loginSchema.safeParse({ identifier: 'ana@exemplo.com', password: '1' }).success).toBe(true)
  })
})
