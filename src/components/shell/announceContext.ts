import { createContext, useContext } from 'react'

export type Announce = (message: string) => void

export const AnnounceContext = createContext<Announce>(() => {})

/** Anuncia uma mensagem para leitores de tela na região aria-live global do AppShell. */
export function useAnnounce(): Announce {
  return useContext(AnnounceContext)
}
