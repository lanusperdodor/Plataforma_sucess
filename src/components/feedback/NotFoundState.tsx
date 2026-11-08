import { SearchX } from 'lucide-react'
import type { ReactNode } from 'react'
import { StateShell } from './StateShell'

export interface NotFoundStateProps {
  title?: string
  description?: string
  action?: ReactNode
}

export function NotFoundState({
  title = 'Não encontramos o que você procura',
  description = 'O conteúdo pode ter sido removido ou o endereço está incorreto.',
  action,
}: NotFoundStateProps) {
  return <StateShell icon={SearchX} title={title} description={description} action={action} />
}
