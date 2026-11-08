import { useEffect, useState } from 'react'

export const COMPACT_ENTER_Y = 48
export const COMPACT_EXIT_Y = 8

/** Histerese: compacta acima de 48, expande até 8, mantém entre os dois. */
export function nextCompactState(prev: boolean, y: number): boolean {
  if (y > COMPACT_ENTER_Y) return true
  if (y <= COMPACT_EXIT_Y) return false
  return prev
}

/** Observa a rolagem (listener passivo + rAF) e devolve se o cabeçalho está compacto. */
export function useCompactHeader(): boolean {
  const [compact, setCompact] = useState(false)

  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      setCompact((prev) => nextCompactState(prev, window.scrollY))
    }
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame !== 0) window.cancelAnimationFrame(frame)
    }
  }, [])

  return compact
}
