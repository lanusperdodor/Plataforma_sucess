import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InstallAppPage, detectDevice } from './InstallAppPage.tsx'

afterEach(cleanup)

describe('Baixe o app', () => {
  it('reconhece Android e iPhone', () => {
    expect(detectDevice('Mozilla/5.0 (Linux; Android 14; SM-A546E)')).toBe('android')
    expect(detectDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iphone')
    expect(detectDevice('Mozilla/5.0 (Windows NT 10.0)')).toBe('outro')
  })
  it('Android: mostra o botão Instalar quando o Chrome oferece a instalação', async () => {
    render(<MemoryRouter><InstallAppPage /></MemoryRouter>)
    const ev = Object.assign(new Event('beforeinstallprompt'), { prompt: vi.fn().mockResolvedValue(undefined), userChoice: Promise.resolve({ outcome: 'accepted' }) })
    act(() => { window.dispatchEvent(ev) })
    fireEvent.click(await screen.findByRole('button', { name: 'Instalar o app' }))
    expect(await screen.findByText(/já está instalada/)).toBeInTheDocument()
    expect(ev.prompt).toHaveBeenCalled()
  })
})
