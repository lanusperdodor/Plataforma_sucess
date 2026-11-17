import { afterEach, describe, expect, it, vi } from 'vitest'
import { alertNewOffers } from './offerAlert'

describe('aviso de corrida nova', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  it('sem toque na tela (som do site bloqueado): dispara a notificação do celular, que toca e vibra sozinha', async () => {
    const show = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('Notification', { permission: 'granted' })
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: () => Promise.resolve({ showNotification: show }) } })
    alertNewOffers(1)
    await vi.waitFor(() => expect(show).toHaveBeenCalledWith('Nova corrida disponível', expect.objectContaining({ tag: 'tucai-corrida', renotify: true, silent: false })))
  })
  it('sem permissão de notificação: não quebra', () => {
    vi.stubGlobal('Notification', { permission: 'default' })
    expect(() => alertNewOffers(2)).not.toThrow()
  })
})
