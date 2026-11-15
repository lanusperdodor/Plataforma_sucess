import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reloadForNewVersion } from './staleBuild'

describe('versão nova publicada com a aba aberta', () => {
  const reload = vi.fn()
  beforeEach(() => {
    sessionStorage.clear()
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } })
  })
  afterEach(() => { reload.mockReset(); vi.useRealTimers() })
  it('recarrega sozinho uma vez e não entra em laço', () => {
    expect(reloadForNewVersion()).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    // falhou de novo logo depois (sem internet de verdade): não recarrega, deixa a tela de erro aparecer
    expect(reloadForNewVersion()).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })
  it('depois de 1 minuto pode recarregar de novo (próxima publicação)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'))
    expect(reloadForNewVersion()).toBe(true)
    vi.setSystemTime(new Date('2026-11-15T10:01:30Z'))
    expect(reloadForNewVersion()).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })
})
