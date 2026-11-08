import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().trim().email('Informe um e-mail válido'),
  password: z.string().min(1, 'Informe a senha'),
})

const strongPassword = z
  .string()
  .min(10, 'Use ao menos 10 caracteres')
  .max(72, 'Use no máximo 72 caracteres')
  .regex(/[A-Za-z]/, 'Inclua letras')
  .regex(/\d/, 'Inclua números')

export const signUpSchema = z.object({
  fullName: z.string().trim().min(2, 'Informe seu nome').max(120),
  email: z.string().trim().email('Informe um e-mail válido'),
  password: strongPassword,
})

export const resetSchema = z.object({ email: z.string().trim().email('Informe um e-mail válido') })

export const newPasswordSchema = z
  .object({ password: strongPassword, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'As senhas não conferem', path: ['confirm'] })

export const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Informe seu nome').max(120),
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[\d\s()+-]*$/, 'Telefone inválido')
    .optional(),
})

export type LoginValues = z.infer<typeof loginSchema>
export type SignUpValues = z.infer<typeof signUpSchema>
export type ResetValues = z.infer<typeof resetSchema>
export type NewPasswordValues = z.infer<typeof newPasswordSchema>
export type ProfileValues = z.infer<typeof profileSchema>
