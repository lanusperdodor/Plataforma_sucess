import { describe, expect, it } from 'vitest'
import { adminIdentifierToEmail, adminLoginSchema } from './schemas'

describe('login administrativo por usuário', () => {
  it('converte usuário em e-mail da administração e mantém e-mails completos', () => {
    expect(adminIdentifierToEmail(' Admin ')).toBe('admin@tucai.example.com')
    expect(adminIdentifierToEmail('Equipe@Tucai.com.br')).toBe('equipe@tucai.com.br')
  })
  it('valida usuário ou e-mail', () => {
    expect(adminLoginSchema.safeParse({ identifier: 'admin', password: 'x' }).success).toBe(true)
    expect(adminLoginSchema.safeParse({ identifier: 'ADMIN', password: 'x' }).success).toBe(true)
    expect(adminLoginSchema.safeParse({ identifier: 'a b', password: 'x' }).success).toBe(false)
    expect(adminLoginSchema.safeParse({ identifier: 'x@', password: 'x' }).success).toBe(false)
  })
})
