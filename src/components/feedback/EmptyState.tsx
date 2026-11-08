import { Inbox, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { StateShell } from './StateShell'

export interface EmptyStateProps {
  title: string
  description?: string
  icon?: LucideIcon
  action?: ReactNode
}

export function EmptyState({ title, description, icon = Inbox, action }: EmptyStateProps) {
  return <StateShell icon={icon} title={title} description={description} action={action} />
}
