import { useEffect, useLayoutEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { z } from 'zod'
import { readStorage, writeStorage } from '../lib/storage'

const MAX_WAIT_MS = 1000
const positionSchema = z.number().finite().min(0)
const storageKey = (key: string) => `scroll:${key}`

/**
 * Sinal de prontidão (store de módulo, sem Provider): cada listagem que chama
 * `useScrollReady` entra no registro. A restauração só ocorre quando todas as
 * registradas estiverem prontas (ou quando nenhuma se registrou).
 */
let registered = 0
let readyCount = 0

function allReady(): boolean {
  return registered === 0 || readyCount === registered
}

/** Chamado pelas listagens: `ready` vira true quando o conteúdo (lista) já foi renderizado. */
export function useScrollReady(ready: boolean): void {
  useLayoutEffect(() => {
    registered += 1
    return () => {
      registered -= 1
    }
  }, [])
  useLayoutEffect(() => {
    if (!ready) return
    readyCount += 1
    return () => {
      readyCount -= 1
    }
  }, [ready])
}

/** Restaura a rolagem em POP (após `ready`, por até 1 s) e rola ao topo em PUSH/REPLACE. */
export function useScrollRestoration(): void {
  const location = useLocation()
  const navigationType = useNavigationType()
  const key = location.key

  useEffect(() => {
    window.history.scrollRestoration = 'manual'
  }, [])

  useLayoutEffect(() => {
    let lastY = window.scrollY
    const onScroll = () => {
      lastY = window.scrollY
    }
    window.addEventListener('scroll', onScroll, { passive: true })

    let frame = 0
    let cancelled = false

    if (navigationType === 'POP') {
      const target = readStorage(storageKey(key), positionSchema, 'session')
      if (target !== null && target > 0) {
        let readySince: number | null = null
        const attempt = (now: number) => {
          if (cancelled) return
          if (allReady()) {
            readySince ??= now
            const tall = document.documentElement.scrollHeight - window.innerHeight >= target
            const expired = now - readySince >= MAX_WAIT_MS
            if (tall || expired) {
              window.scrollTo(0, target)
              lastY = target
              return
            }
          }
          frame = window.requestAnimationFrame(attempt)
        }
        frame = window.requestAnimationFrame(attempt)
      }
    } else {
      window.scrollTo(0, 0)
      lastY = 0
    }

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      writeStorage(storageKey(key), lastY, 'session')
    }
  }, [key, navigationType])
}

/** Usado apenas em testes para zerar o registro entre casos. */
export function resetScrollReadyForTests(): void {
  registered = 0
  readyCount = 0
}
